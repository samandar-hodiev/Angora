package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// Route selects the provider and model for a task.
type Route struct {
	Provider string
	Model    string
}

// Pricing is used to estimate cost per call. Prices change, so they are configuration.
type Pricing struct {
	InputPerMillionUSD  float64
	OutputPerMillionUSD float64
	AudioPerMinuteUSD   float64
}

type GatewayConfig struct {
	DefaultProvider string
	DefaultModel    string
	// Routes overrides provider/model per task, e.g. transcription on one vendor and
	// writing evaluation on another.
	Routes map[Task]Route
	// Pricing is keyed by "provider/model".
	Pricing map[string]Pricing
}

// CallMeta describes who the call is for and why. It feeds usage and cost tracking.
type CallMeta struct {
	Task          Task
	UserID        *uuid.UUID
	PromptVersion string
	Metadata      map[string]any
}

type Gateway struct {
	providers map[string]Provider
	cfg       GatewayConfig
	recorder  UsageRecorder
	log       *slog.Logger
	now       func() time.Time
}

func NewGateway(cfg GatewayConfig, recorder UsageRecorder, log *slog.Logger, providers ...Provider) (*Gateway, error) {
	g := &Gateway{providers: map[string]Provider{}, cfg: cfg, recorder: recorder, log: log, now: time.Now}
	for _, p := range providers {
		g.providers[p.Name()] = p
	}
	if _, ok := g.providers[cfg.DefaultProvider]; !ok {
		return nil, fmt.Errorf("default AI provider %q is not registered", cfg.DefaultProvider)
	}
	for task, route := range cfg.Routes {
		if _, ok := g.providers[route.Provider]; !ok {
			return nil, fmt.Errorf("route for task %q uses unregistered provider %q", task, route.Provider)
		}
	}
	return g, nil
}

func (g *Gateway) GenerateText(ctx context.Context, meta CallMeta, req TextRequest) (*TextResponse, error) {
	return invoke(ctx, g, meta, req.Model, func(p Provider, model string) (*TextResponse, Usage, error) {
		req.Model = model
		res, err := p.GenerateText(ctx, req)
		if err != nil {
			return nil, Usage{}, err
		}
		return res, res.Usage, nil
	}, func(res *TextResponse, id uuid.UUID) { res.AIRequestID = id })
}

func (g *Gateway) AnalyzeText(ctx context.Context, meta CallMeta, req AnalysisRequest) (*AnalysisResponse, error) {
	return invoke(ctx, g, meta, req.Model, func(p Provider, model string) (*AnalysisResponse, Usage, error) {
		req.Model = model
		res, err := p.AnalyzeText(ctx, req)
		if err != nil {
			return nil, Usage{}, err
		}
		return res, res.Usage, nil
	}, func(res *AnalysisResponse, id uuid.UUID) { res.AIRequestID = id })
}

func (g *Gateway) TranscribeAudio(ctx context.Context, meta CallMeta, req TranscriptionRequest) (*TranscriptionResponse, error) {
	return invoke(ctx, g, meta, req.Model, func(p Provider, model string) (*TranscriptionResponse, Usage, error) {
		req.Model = model
		res, err := p.TranscribeAudio(ctx, req)
		if err != nil {
			return nil, Usage{}, err
		}
		return res, res.Usage, nil
	}, func(res *TranscriptionResponse, id uuid.UUID) { res.AIRequestID = id })
}

func (g *Gateway) route(task Task) Route {
	r, ok := g.cfg.Routes[task]
	if !ok || r.Provider == "" {
		r.Provider = g.cfg.DefaultProvider
	}
	if r.Model == "" && r.Provider == g.cfg.DefaultProvider {
		r.Model = g.cfg.DefaultModel
	}
	return r
}

func invoke[R any](ctx context.Context, g *Gateway, meta CallMeta, requestedModel string,
	run func(Provider, string) (R, Usage, error), setID func(R, uuid.UUID)) (R, error) {
	var zero R
	route := g.route(meta.Task)
	provider := g.providers[route.Provider]
	model := route.Model
	if requestedModel != "" {
		model = requestedModel
	}

	start := g.now()
	res, usage, err := run(provider, model)
	latency := g.now().Sub(start)

	record := UsageRecord{
		ID:            uuid.New(),
		UserID:        meta.UserID,
		Task:          meta.Task,
		Provider:      provider.Name(),
		Model:         model,
		Succeeded:     err == nil,
		Usage:         usage,
		EstimatedCost: EstimateCost(g.cfg.Pricing[provider.Name()+"/"+model], usage),
		Latency:       latency,
		ErrorCode:     errorCode(err),
		PromptVersion: meta.PromptVersion,
		Metadata:      meta.Metadata,
	}
	g.recorder.Record(ctx, record)

	if err != nil {
		logger.FromContext(ctx, g.log).Warn("ai provider call failed",
			slog.String("task", string(meta.Task)),
			slog.String("provider", provider.Name()),
			slog.String("model", model),
			slog.Int64("latency_ms", latency.Milliseconds()),
			slog.String("error", err.Error()),
		)
		if errors.Is(err, ErrUnsupported) {
			return zero, apperr.Wrap(err, apperr.CodeNotImplemented, "This AI capability is not available yet")
		}
		return zero, apperr.Wrap(err, apperr.CodeUnavailable, "The AI service is temporarily unavailable, please try again")
	}
	setID(res, record.ID)
	return res, nil
}

// EstimateCost returns the estimated USD cost of a call. Unknown pricing yields 0, which
// shows up in cost reports as "unpriced" usage rather than silently wrong numbers.
func EstimateCost(p Pricing, u Usage) float64 {
	return float64(u.InputTokens)/1e6*p.InputPerMillionUSD +
		float64(u.OutputTokens)/1e6*p.OutputPerMillionUSD +
		u.AudioSeconds/60*p.AudioPerMinuteUSD
}

func errorCode(err error) string {
	if err == nil {
		return ""
	}
	var pe *ProviderError
	switch {
	case errors.Is(err, ErrUnsupported):
		return "unsupported"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.As(err, &pe) && pe.StatusCode == 429:
		return "rate_limited"
	case errors.As(err, &pe) && pe.StatusCode >= 500:
		return "provider_unavailable"
	case errors.As(err, &pe):
		return fmt.Sprintf("provider_%d", pe.StatusCode)
	default:
		return "error"
	}
}
