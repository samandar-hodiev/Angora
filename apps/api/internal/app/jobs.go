package app

import (
	"github.com/samandar-hodiev/engora/apps/api/internal/assessment"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
)

// RegisterJobHandlers plugs feature modules into a worker. Both the standalone worker
// process and the API's embedded development worker use it, so they run the same jobs.
func RegisterJobHandlers(w *jobs.Worker, c *Container) {
	w.Handle(assessment.JobEvaluateSection, c.Assessment.HandleEvaluationJob)
}
