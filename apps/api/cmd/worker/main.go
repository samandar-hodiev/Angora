// Command worker processes background jobs (AI transcription, evaluation, ...).
//
// It shares the Container with the API server, so handlers use the same services,
// database and AI gateway. Scale workers independently of API instances.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/app"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.App.LogLevel, cfg.App.LogFormat).With(slog.String("process", "worker"))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	container, err := app.New(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer container.Close()

	worker := jobs.NewWorker(container.Jobs, log, container.Reporter)
	registerHandlers(worker, container)

	log.Info("worker started", slog.Any("job_types", worker.Types()), slog.Int("concurrency", worker.Concurrency))
	worker.Run(ctx)
	log.Info("worker stopped")
	return nil
}

// registerHandlers is where feature modules plug in their job handlers, e.g. in Phase 2:
//
//	worker.Handle(jobs.TypeSpeakingEvaluate, speaking.NewEvaluationHandler(c.AI, c.Storage, c.DB).Handle)
func registerHandlers(_ *jobs.Worker, _ *app.Container) {}
