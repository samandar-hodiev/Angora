package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
)

// Placement assessment content: reading passages and listening clips (stimuli) with their
// questions, and writing/speaking tasks, for every CEFR level A1..C2. It is authored as data
// (placement/content.json), exactly the shape a future admin editor will write.

//go:embed placement/content.json
var placementContentJSON []byte

//go:embed placement/audio
var placementAudio embed.FS

type placementQuestion struct {
	Key         string   `json:"key"`
	Type        string   `json:"type"`
	Difficulty  int      `json:"difficulty"`
	Prompt      string   `json:"prompt"`
	Options     []string `json:"options"`
	Answer      int      `json:"answer"`
	Explanation string   `json:"explanation"`
}

type placementStimulus struct {
	Slug       string              `json:"slug"`
	Level      string              `json:"level"`
	Title      string              `json:"title"`
	Topic      string              `json:"topic"`
	Difficulty int                 `json:"difficulty"`
	Passage    string              `json:"passage"`
	Transcript string              `json:"transcript"`
	Questions  []placementQuestion `json:"questions"`
}

type placementTask struct {
	Slug            string   `json:"slug"`
	Level           string   `json:"level"`
	Topic           string   `json:"topic"`
	Difficulty      int      `json:"difficulty"`
	Prompt          string   `json:"prompt"`
	Instructions    []string `json:"instructions"`
	Guidance        []string `json:"guidance"`
	MinWords        int      `json:"min_words"`
	MaxWords        int      `json:"max_words"`
	PrepSeconds     int      `json:"prep_seconds"`
	ResponseSeconds int      `json:"response_seconds"`
}

type placementContent struct {
	Reading   []placementStimulus `json:"reading"`
	Listening []placementStimulus `json:"listening"`
	Writing   []placementTask     `json:"writing"`
	Speaking  []placementTask     `json:"speaking"`
}

var trueFalseNotGiven = []string{"True", "False", "Not given"}

type option struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

func seedPlacement(ctx context.Context, pool *pgxpool.Pool) error {
	var content placementContent
	if err := json.Unmarshal(placementContentJSON, &content); err != nil {
		return fmt.Errorf("placement content: %w", err)
	}
	var durations map[string]int
	raw, err := placementAudio.ReadFile("placement/audio/durations.json")
	if err != nil {
		return fmt.Errorf("placement audio: %w (run infrastructure/scripts/generate-placement-audio.mjs)", err)
	}
	if err := json.Unmarshal(raw, &durations); err != nil {
		return fmt.Errorf("placement audio durations: %w", err)
	}

	cfg, err := config.FromLookup(os.LookupEnv)
	if err != nil {
		return err
	}
	store, err := storage.New(cfg.Storage)
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}

	items := 0
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		for _, s := range content.Reading {
			id, err := upsertStimulus(ctx, tx, "reading_passage", "reading", s, map[string]any{"passage": s.Passage})
			if err != nil {
				return err
			}
			n, err := upsertQuestions(ctx, tx, "reading", s, id)
			if err != nil {
				return err
			}
			items += n
		}
		for _, s := range content.Listening {
			audioID, err := uploadClip(ctx, tx, store, s.Slug, durations[s.Slug])
			if err != nil {
				return err
			}
			id, err := upsertStimulus(ctx, tx, "listening_clip", "listening", s, map[string]any{
				"audio_file_id": audioID, "duration_ms": durations[s.Slug], "transcript": s.Transcript,
			})
			if err != nil {
				return err
			}
			n, err := upsertQuestions(ctx, tx, "listening", s, id)
			if err != nil {
				return err
			}
			items += n
		}
		for _, t := range content.Writing {
			settings := map[string]any{"min_words": t.MinWords, "max_words": t.MaxWords, "instructions": t.Instructions}
			if err := upsertItem(ctx, tx, t.Slug, "writing", t.Level, t.Difficulty, t.Topic, "writing_task", nil, 1, t.Prompt, []option{}, nil, "", settings); err != nil {
				return err
			}
			items++
		}
		for _, t := range content.Speaking {
			settings := map[string]any{"prep_seconds": t.PrepSeconds, "response_seconds": t.ResponseSeconds, "guidance": t.Guidance}
			if err := upsertItem(ctx, tx, t.Slug, "speaking", t.Level, t.Difficulty, t.Topic, "speaking_task", nil, 1, t.Prompt, []option{}, nil, "", settings); err != nil {
				return err
			}
			items++
		}
		return nil
	})
	if err != nil {
		return err
	}
	fmt.Printf("placement ready: %d reading passages, %d listening clips, %d assessment items\n",
		len(content.Reading), len(content.Listening), items)
	return nil
}

func upsertStimulus(ctx context.Context, tx pgx.Tx, typ, skill string, s placementStimulus, body map[string]any) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		UPDATE content_items SET body = $3, difficulty = $4, level_id = (SELECT id FROM levels WHERE code = $5),
		       topic_id = (SELECT id FROM topics WHERE slug = $6), status = 'published', published_at = COALESCE(published_at, now())
		WHERE type = $1 AND title = $2 AND exam = 'placement'
		RETURNING id`, typ, s.Title, body, s.Difficulty, s.Level, s.Topic).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO content_items (type, title, skill_id, level_id, topic_id, exam, difficulty, tags, status, body, published_at)
			VALUES ($1, $2, (SELECT id FROM skills WHERE code = $3), (SELECT id FROM levels WHERE code = $4),
			        (SELECT id FROM topics WHERE slug = $5), 'placement', $6, '{placement}', 'published', $7, now())
			RETURNING id`, typ, s.Title, skill, s.Level, s.Topic, s.Difficulty, body).Scan(&id)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("stimulus %s: %w", s.Slug, err)
	}
	return id, nil
}

func upsertQuestions(ctx context.Context, tx pgx.Tx, skill string, s placementStimulus, stimulusID uuid.UUID) (int, error) {
	for i, q := range s.Questions {
		texts := q.Options
		if q.Type == "true_false_not_given" {
			texts = trueFalseNotGiven
		}
		if q.Answer < 0 || q.Answer >= len(texts) {
			return 0, fmt.Errorf("%s-%s: answer index out of range", s.Slug, q.Key)
		}
		opts := make([]option, len(texts))
		for j, t := range texts {
			opts[j] = option{ID: string(rune('a' + j)), Text: t}
		}
		key := map[string]string{"option_id": opts[q.Answer].ID}
		if err := upsertItem(ctx, tx, s.Slug+"-"+q.Key, skill, s.Level, q.Difficulty, s.Topic, q.Type, &stimulusID, i+1,
			q.Prompt, opts, key, q.Explanation, map[string]any{}); err != nil {
			return 0, err
		}
	}
	return len(s.Questions), nil
}

func upsertItem(ctx context.Context, tx pgx.Tx, slug, skill, level string, difficulty int, topic, itemType string,
	stimulusID *uuid.UUID, position int, prompt string, options []option, answerKey map[string]string, explanation string,
	settings map[string]any) error {
	var key any
	if answerKey != nil {
		key = answerKey
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO assessment_items (slug, kind, skill, level_id, difficulty, topic, item_type, stimulus_id, position,
		                              prompt, options, answer_key, explanation, settings, status, published_at)
		VALUES ($1, 'placement', $2, (SELECT id FROM levels WHERE code = $3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'published', now())
		ON CONFLICT (slug) DO UPDATE SET
		    version = assessment_items.version + CASE WHEN
		        (assessment_items.prompt, assessment_items.options, assessment_items.answer_key, assessment_items.settings)
		        IS DISTINCT FROM (EXCLUDED.prompt, EXCLUDED.options, EXCLUDED.answer_key, EXCLUDED.settings) THEN 1 ELSE 0 END,
		    skill = EXCLUDED.skill, level_id = EXCLUDED.level_id, difficulty = EXCLUDED.difficulty, topic = EXCLUDED.topic,
		    item_type = EXCLUDED.item_type, stimulus_id = EXCLUDED.stimulus_id, position = EXCLUDED.position,
		    prompt = EXCLUDED.prompt, options = EXCLUDED.options, answer_key = EXCLUDED.answer_key,
		    explanation = EXCLUDED.explanation, settings = EXCLUDED.settings, status = 'published',
		    published_at = COALESCE(assessment_items.published_at, now())`,
		slug, skill, level, difficulty, topic, itemType, stimulusID, position, prompt, options, key, explanation, settings)
	if err != nil {
		return fmt.Errorf("assessment item %s: %w", slug, err)
	}
	return nil
}

// uploadClip stores a listening clip in object storage and records its metadata. Audio
// bytes never go into PostgreSQL.
func uploadClip(ctx context.Context, tx pgx.Tx, store storage.ObjectStorage, slug string, durationMs int) (uuid.UUID, error) {
	data, err := placementAudio.ReadFile("placement/audio/" + slug + ".m4a")
	if err != nil {
		return uuid.Nil, fmt.Errorf("clip %s: %w (run infrastructure/scripts/generate-placement-audio.mjs)", slug, err)
	}
	sum := sha256.Sum256(data)
	key := "content/placement/listening/" + slug + ".m4a"
	if err := store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), "audio/mp4"); err != nil {
		return uuid.Nil, fmt.Errorf("upload clip %s: %w", slug, err)
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO audio_files (user_id, storage_provider, storage_key, mime_type, size_bytes, duration_ms, checksum_sha256, purpose, status)
		VALUES (NULL, $1, $2, 'audio/mp4', $3, $4, $5, 'assessment_content', 'ready')
		ON CONFLICT (storage_key) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, duration_ms = EXCLUDED.duration_ms,
		    checksum_sha256 = EXCLUDED.checksum_sha256, storage_provider = EXCLUDED.storage_provider, status = 'ready'
		RETURNING id`, store.Provider(), key, len(data), durationMs, hex.EncodeToString(sum[:])).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("audio metadata %s: %w", slug, err)
	}
	return id, nil
}
