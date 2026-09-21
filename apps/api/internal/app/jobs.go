package app

import (
	"context"

	"github.com/samandar-hodiev/engora/apps/api/internal/assessment"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/notifications"
)

// RegisterJobHandlers plugs feature modules into a worker. Both the standalone worker
// process and the API's embedded development worker use it, so they run the same jobs.
func RegisterJobHandlers(w *jobs.Worker, c *Container) {
	w.Handle(assessment.JobEvaluateSection, c.Assessment.HandleEvaluationJob)
}

// StartScheduler runs the sweeps that are about time passing rather than about anything a
// learner did: subscriptions about to end, streaks about to break. It belongs with the
// worker, not the API, so it runs once per deployment rather than once per API instance —
// and even if it did run twice, every sweep asks the database who has already been told.
func StartScheduler(ctx context.Context, c *Container) {
	go notifications.NewScheduler(c.Notifications, c.Log).Run(ctx)
}
