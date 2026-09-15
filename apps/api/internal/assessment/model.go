// Package assessment runs Engora's placement assessment: a four-skill, sequential,
// server-timed test whose content comes from the assessment item bank and whose scores are
// computed only on the server.
//
//	create ─▶ sections (reading → listening → writing → speaking), items fixed per section
//	start section ─▶ deadline set by the server
//	answers autosaved (objective choices, writing drafts) / recordings uploaded (speaking)
//	submit section ─▶ reading/listening scored immediately; writing/speaking queued for AI
//	                  evaluation (jobs) and the next section unlocks
//	all skill results ─▶ scoring.Combine ─▶ assessment_results, user_levels, skill_progress,
//	                     weaknesses, personalised plan
//
// Every client (web, iOS, Android) drives the same endpoints; nothing about the test lives
// only in a client. Assessments are never deleted, so history is preserved.
package assessment

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/assessment/scoring"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

const KindPlacement = "placement"

// Skills in test order.
var Skills = []string{scoring.SkillReading, scoring.SkillListening, scoring.SkillWriting, scoring.SkillSpeaking}

func isObjective(skill string) bool {
	return skill == scoring.SkillReading || skill == scoring.SkillListening
}

const (
	StatusInProgress = "in_progress"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusAbandoned  = "abandoned"
)

const (
	SectionLocked     = "locked"
	SectionAvailable  = "available"
	SectionInProgress = "in_progress"
	SectionEvaluating = "evaluating"
	SectionCompleted  = "completed"
	SectionFailed     = "failed"
)

// ---- Configuration ------------------------------------------------------------------------

type SectionConfig struct {
	Skill            string         `json:"skill"`
	TimeLimitSeconds int            `json:"time_limit_seconds"`
	Items            map[string]int `json:"items"` // band → number of items
	MaxPlays         int            `json:"max_plays,omitempty"`
	MaxAttempts      int            `json:"max_attempts,omitempty"`
}

// Config is stored in assessment_configs and snapshotted onto each assessment.
type Config struct {
	GraceSeconds int             `json:"grace_seconds"`
	Sections     []SectionConfig `json:"sections"`
}

func (c Config) Section(skill string) (SectionConfig, bool) {
	for _, s := range c.Sections {
		if s.Skill == skill {
			return s, true
		}
	}
	return SectionConfig{}, false
}

func (c Config) Validate() error {
	var errs []error
	if len(c.Sections) == 0 {
		errs = append(errs, errors.New("no sections"))
	}
	seen := map[string]bool{}
	for i, s := range c.Sections {
		if !slices.Contains(Skills, s.Skill) || seen[s.Skill] {
			errs = append(errs, fmt.Errorf("sections[%d]: invalid or duplicate skill %q", i, s.Skill))
		}
		seen[s.Skill] = true
		if s.TimeLimitSeconds <= 0 {
			errs = append(errs, fmt.Errorf("sections[%d]: time_limit_seconds must be positive", i))
		}
		total := 0
		for band, n := range s.Items {
			if band != scoring.BandFoundation && band != scoring.BandCore && band != scoring.BandChallenge {
				errs = append(errs, fmt.Errorf("sections[%d]: unknown band %q", i, band))
			}
			total += n
		}
		if total == 0 {
			errs = append(errs, fmt.Errorf("sections[%d]: no items", i))
		}
	}
	if c.GraceSeconds < 0 {
		errs = append(errs, errors.New("grace_seconds must not be negative"))
	}
	return errors.Join(errs...)
}

// ---- API views ----------------------------------------------------------------------------

type Assessment struct {
	ID          uuid.UUID  `json:"id"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	Source      string     `json:"source"`
	StartLevel  cefr.Level `json:"start_level"`
	StartedAt   time.Time  `json:"started_at"`
	SubmittedAt *time.Time `json:"submitted_at"`
	CompletedAt *time.Time `json:"completed_at"`
	AbandonedAt *time.Time `json:"abandoned_at"`
	// CurrentSkill is the section in progress, or the next one to start.
	CurrentSkill *string   `json:"current_skill"`
	Sections     []Section `json:"sections"`
	ServerTime   time.Time `json:"server_time"`
}

type Section struct {
	Skill            string     `json:"skill"`
	Position         int        `json:"position"`
	Status           string     `json:"status"`
	TimeLimitSeconds int        `json:"time_limit_seconds"`
	ItemCount        int        `json:"item_count"`
	AnsweredCount    int        `json:"answered_count"`
	MaxAttempts      int        `json:"max_attempts,omitempty"`
	MaxPlays         int        `json:"max_plays,omitempty"`
	StartedAt        *time.Time `json:"started_at"`
	DeadlineAt       *time.Time `json:"deadline_at"`
	SubmittedAt      *time.Time `json:"submitted_at"`
	CompletedAt      *time.Time `json:"completed_at"`
	ErrorCode        string     `json:"error_code,omitempty"`
}

type Option struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type Stimulus struct {
	ID         uuid.UUID `json:"id"`
	Type       string    `json:"type"` // reading_passage | listening_clip
	Title      string    `json:"title"`
	Passage    *string   `json:"passage,omitempty"`
	HasAudio   bool      `json:"has_audio"`
	DurationMs *int      `json:"duration_ms,omitempty"`
	// Transcript is only returned once the section is no longer in progress.
	Transcript *string `json:"transcript,omitempty"`
}

// Item never includes the answer key, level or band.
type Item struct {
	ID         uuid.UUID      `json:"id"`
	Position   int            `json:"position"`
	Type       string         `json:"type"`
	StimulusID *uuid.UUID     `json:"stimulus_id"`
	Prompt     string         `json:"prompt"`
	Options    []Option       `json:"options"`
	Settings   map[string]any `json:"settings"`
}

type Attempt struct {
	ID            uuid.UUID `json:"id"`
	AttemptNumber int       `json:"attempt_number"`
	Status        string    `json:"status"`
	DurationMs    *int      `json:"duration_ms"`
	CreatedAt     time.Time `json:"created_at"`
}

type Answer struct {
	ItemID     uuid.UUID       `json:"item_id"`
	Response   json.RawMessage `json:"response"`
	AnsweredAt time.Time       `json:"answered_at"`
	Attempts   []Attempt       `json:"attempts,omitempty"`
}

type SectionContent struct {
	AssessmentID uuid.UUID  `json:"assessment_id"`
	Section      Section    `json:"section"`
	Stimuli      []Stimulus `json:"stimuli"`
	Items        []Item     `json:"items"`
	Answers      []Answer   `json:"answers"`
	ServerTime   time.Time  `json:"server_time"`
}

type SkillResult struct {
	Skill      string             `json:"skill"`
	Score      float64            `json:"score"`
	CEFR       cefr.Level         `json:"cefr"`
	Confidence float64            `json:"confidence"`
	Subscores  map[string]float64 `json:"subscores"`
}

type Overall struct {
	CEFR       cefr.Level `json:"cefr"`
	Score      float64    `json:"score"`
	Confidence float64    `json:"confidence"`
}

type Result struct {
	AssessmentID   uuid.UUID       `json:"assessment_id"`
	Kind           string          `json:"kind"`
	Source         string          `json:"source"`
	StartLevel     cefr.Level      `json:"start_level"`
	Overall        Overall         `json:"overall"`
	Skills         []SkillResult   `json:"skills"`
	Strengths      []scoring.Area  `json:"strengths"`
	FocusAreas     []scoring.Area  `json:"focus_areas"`
	Summary        scoring.Summary `json:"summary"`
	ScoringVersion string          `json:"scoring_version"`
	CompletedAt    time.Time       `json:"completed_at"`
}

type HistoryItem struct {
	ID           uuid.UUID   `json:"id"`
	Kind         string      `json:"kind"`
	Status       string      `json:"status"`
	Source       string      `json:"source"`
	StartLevel   cefr.Level  `json:"start_level"`
	OverallCEFR  *cefr.Level `json:"overall_cefr"`
	OverallScore *float64    `json:"overall_score"`
	StartedAt    time.Time   `json:"started_at"`
	CompletedAt  *time.Time  `json:"completed_at"`
}
