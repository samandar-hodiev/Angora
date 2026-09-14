package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sort"
	"sync"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
)

// Handler processes one job. The returned map is stored as the job's result reference.
type Handler func(ctx context.Context, job *Job) (map[string]any, error)

type permanentError struct {
	code string
	err  error
}

func (e *permanentError) Error() string { return e.code + ": " + e.err.Error() }
func (e *permanentError) Unwrap() error { return e.err }

// Permanent marks an error that retrying cannot fix (invalid input, missing file).
// code is client-safe and is exposed through the job state.
func Permanent(code string, err error) error {
	return &permanentError{code: code, err: err}
}

type Worker struct {
	queue       Queue
	handlers    map[string]Handler
	log         *slog.Logger
	reporter    observability.ErrorReporter
	Concurrency int
	PollWait    time.Duration
	JobTimeout  time.Duration
}

func NewWorker(queue Queue, log *slog.Logger, reporter observability.ErrorReporter) *Worker {
	return &Worker{
		queue:       queue,
		handlers:    map[string]Handler{},
		log:         log,
		reporter:    reporter,
		Concurrency: 4,
		PollWait:    5 * time.Second,
		JobTimeout:  5 * time.Minute,
	}
}

// Handle registers the handler for a job type.
func (w *Worker) Handle(jobType string, h Handler) {
	w.handlers[jobType] = h
}

func (w *Worker) Types() []string {
	types := make([]string, 0, len(w.handlers))
	for t := range w.handlers {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// Run processes jobs until ctx is cancelled, then waits for in-flight jobs to finish.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < max(w.Concurrency, 1); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.loop(ctx)
		}()
	}
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context) {
	for ctx.Err() == nil {
		job, err := w.queue.Reserve(ctx, w.PollWait)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.log.Error("reserve job failed", slog.String("error", err.Error()))
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		if job != nil {
			w.Process(ctx, job)
		}
	}
}

// Process runs a single reserved job and records its outcome. In-flight jobs are not
// cancelled by shutdown; they are bounded by JobTimeout instead.
func (w *Worker) Process(ctx context.Context, job *Job) {
	ctx = context.WithoutCancel(ctx)
	log := w.log.With(slog.String("job_id", job.ID.String()), slog.String("job_type", job.Type),
		slog.Int("attempt", job.Attempts))

	outcome := w.execute(ctx, job, log)
	if err := w.queue.Finish(ctx, job, outcome); err != nil {
		w.reporter.Report(ctx, fmt.Errorf("finish job %s: %w", job.ID, err))
	}
}

func (w *Worker) execute(ctx context.Context, job *Job, log *slog.Logger) Outcome {
	handler, ok := w.handlers[job.Type]
	if !ok {
		log.Error("no handler registered for job type")
		return Outcome{Status: StatusFailed, ErrorCode: "unknown_job_type"}
	}

	start := time.Now()
	jobCtx, cancel := context.WithTimeout(ctx, w.JobTimeout)
	defer cancel()
	result, err := safeRun(jobCtx, handler, job)
	elapsed := slog.Int64("duration_ms", time.Since(start).Milliseconds())

	if err == nil {
		log.Info("job succeeded", elapsed)
		return Outcome{Status: StatusSucceeded, Result: result}
	}

	var perm *permanentError
	switch {
	case errors.As(err, &perm):
		log.Warn("job failed permanently", elapsed, slog.String("error", err.Error()))
		return Outcome{Status: StatusFailed, ErrorCode: perm.code}
	case job.Attempts >= job.MaxAttempts:
		w.reporter.Report(ctx, err, slog.String("job_id", job.ID.String()), slog.String("job_type", job.Type))
		return Outcome{Status: StatusFailed, ErrorCode: errorCode(err)}
	default:
		log.Warn("job failed, will retry", elapsed, slog.String("error", err.Error()))
		return Outcome{Status: StatusRetrying, ErrorCode: errorCode(err)}
	}
}

func safeRun(ctx context.Context, h Handler, job *Job) (result map[string]any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in job handler: %v\n%s", r, debug.Stack())
		}
	}()
	return h(ctx, job)
}

func errorCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "processing_error"
}
