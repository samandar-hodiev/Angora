// Command server runs the Engora HTTP API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/app"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "server:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.App.LogLevel, cfg.App.LogFormat)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	container, err := app.New(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer container.Close()

	router, err := app.NewRouter(container)
	if err != nil {
		return err
	}

	// In development the API also processes background jobs, so AI evaluations complete
	// without running `make worker`. Production runs dedicated worker processes.
	if cfg.Jobs.EmbeddedWorker {
		worker := jobs.NewWorker(container.Jobs, log.With(slog.String("process", "embedded-worker")), container.Reporter)
		worker.Concurrency = 2
		app.RegisterJobHandlers(worker, container)
		go worker.Run(ctx)
		log.Info("embedded job worker started", slog.Any("job_types", worker.Types()))
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.App.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       60 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info("api listening", slog.String("addr", srv.Addr), slog.String("version", cfg.App.Version))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down api")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
