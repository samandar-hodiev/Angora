package admin

import (
	"sort"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// AI spend over time, per provider.
//
// Cost is worked out here from the tokens each call used and the model's price
// (ai.DefaultPricing), not read from what the gateway stored: calls made before prices were
// configured were stored at $0, and a report that says the platform spent nothing is wrong.

type timelineQuery struct {
	Days int `form:"days" binding:"omitempty,oneof=1 7 30 90"`
}

type ProviderSpend struct {
	Provider     string       `json:"provider"`
	Requests     int64        `json:"requests"`
	Failed       int64        `json:"failed"`
	InputTokens  int64        `json:"input_tokens"`
	OutputTokens int64        `json:"output_tokens"`
	AudioSeconds float64      `json:"audio_seconds"`
	CostUSD      float64      `json:"cost_usd"`
	Models       []ModelSpend `json:"models"`
}

type ModelSpend struct {
	Model    string  `json:"model"`
	Requests int64   `json:"requests"`
	Tokens   int64   `json:"tokens"`
	CostUSD  float64 `json:"cost_usd"`
	// Priced is false for a model missing from the price table; its cost shows as $0.
	Priced bool `json:"priced"`
}

type SpendPoint struct {
	Requests int64   `json:"requests"`
	Tokens   int64   `json:"tokens"`
	CostUSD  float64 `json:"cost_usd"`
}

type TimelinePoint struct {
	At         time.Time             `json:"at"`
	ByProvider map[string]SpendPoint `json:"by_provider"`
}

type TaskSpend struct {
	Task     string  `json:"task"`
	Requests int64   `json:"requests"`
	Failed   int64   `json:"failed"`
	Tokens   int64   `json:"tokens"`
	CostUSD  float64 `json:"cost_usd"`
}

type AITimeline struct {
	Days      int             `json:"days"`
	Bucket    string          `json:"bucket"`
	Providers []ProviderSpend `json:"providers"`
	Points    []TimelinePoint `json:"points"`
	Tasks     []TaskSpend     `json:"tasks"`
	Totals    ProviderSpend   `json:"totals"`
}

// GET /admin/ai/timeline?days=1|7|30|90
func (m *Module) aiTimeline(c *gin.Context) {
	var q timelineQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Days == 0 {
		q.Days = 7
	}
	bucket, step := "day", 24*time.Hour
	if q.Days == 1 {
		bucket, step = "hour", time.Hour
	}
	ctx := c.Request.Context()
	rows, err := m.pool.Query(ctx, `
		SELECT date_trunc($2, created_at AT TIME ZONE 'UTC'), provider, COALESCE(model, ''), COALESCE(task, ''),
		       count(*), count(*) FILTER (WHERE status <> 'succeeded'),
		       COALESCE(sum(input_tokens), 0)::bigint, COALESCE(sum(output_tokens), 0)::bigint,
		       COALESCE(sum(audio_seconds), 0)::float8
		FROM ai_requests
		WHERE created_at > now() - make_interval(days => $1::int)
		GROUP BY 1, 2, 3, 4`, q.Days, bucket)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	providers := map[string]*ProviderSpend{}
	models := map[string]map[string]*ModelSpend{}
	tasks := map[string]*TaskSpend{}
	points := map[time.Time]map[string]SpendPoint{}
	out := AITimeline{Days: q.Days, Bucket: bucket, Providers: []ProviderSpend{}, Points: []TimelinePoint{}, Tasks: []TaskSpend{}}

	for rows.Next() {
		var at time.Time
		var provider, model, task string
		var requests, failed, in, outTokens int64
		var audio float64
		if err := rows.Scan(&at, &provider, &model, &task, &requests, &failed, &in, &outTokens, &audio); err != nil {
			httpx.Fail(c, err)
			return
		}
		price, priced := ai.PriceOf(provider, model)
		cost := ai.CostUSD(price, in, outTokens, audio)
		tokens := in + outTokens

		p := providers[provider]
		if p == nil {
			p = &ProviderSpend{Provider: provider}
			providers[provider] = p
			models[provider] = map[string]*ModelSpend{}
		}
		p.Requests += requests
		p.Failed += failed
		p.InputTokens += in
		p.OutputTokens += outTokens
		p.AudioSeconds += audio
		p.CostUSD += cost
		ms := models[provider][model]
		if ms == nil {
			ms = &ModelSpend{Model: model, Priced: priced}
			models[provider][model] = ms
		}
		ms.Requests += requests
		ms.Tokens += tokens
		ms.CostUSD += cost

		ts := tasks[task]
		if ts == nil {
			ts = &TaskSpend{Task: task}
			tasks[task] = ts
		}
		ts.Requests += requests
		ts.Failed += failed
		ts.Tokens += tokens
		ts.CostUSD += cost

		at = at.UTC()
		if points[at] == nil {
			points[at] = map[string]SpendPoint{}
		}
		sp := points[at][provider]
		sp.Requests += requests
		sp.Tokens += tokens
		sp.CostUSD += cost
		points[at][provider] = sp

		out.Totals.Requests += requests
		out.Totals.Failed += failed
		out.Totals.InputTokens += in
		out.Totals.OutputTokens += outTokens
		out.Totals.AudioSeconds += audio
		out.Totals.CostUSD += cost
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	for name, p := range providers {
		for _, ms := range models[name] {
			p.Models = append(p.Models, *ms)
		}
		sort.Slice(p.Models, func(i, j int) bool { return p.Models[i].CostUSD > p.Models[j].CostUSD })
		out.Providers = append(out.Providers, *p)
	}
	sort.Slice(out.Providers, func(i, j int) bool { return out.Providers[i].CostUSD > out.Providers[j].CostUSD })
	for _, t := range tasks {
		out.Tasks = append(out.Tasks, *t)
	}
	sort.Slice(out.Tasks, func(i, j int) bool { return out.Tasks[i].CostUSD > out.Tasks[j].CostUSD })

	// Every bucket in the window, empty ones included, so the chart has no gaps.
	now := time.Now().UTC()
	end := now.Truncate(step)
	if bucket == "day" {
		end = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	}
	count := q.Days
	if bucket == "hour" {
		count = 24
	}
	for i := count - 1; i >= 0; i-- {
		at := end.Add(-time.Duration(i) * step)
		byProvider := points[at]
		if byProvider == nil {
			byProvider = map[string]SpendPoint{}
		}
		out.Points = append(out.Points, TimelinePoint{At: at, ByProvider: byProvider})
	}
	httpx.OK(c, out)
}
