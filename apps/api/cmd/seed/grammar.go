package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The grammar curriculum lives in JSON rather than Go literals. It is content, not code:
// adding a topic, a relation or a practice question should not mean writing Go, and a CMS
// writing to the same tables later must not have to agree with a hardcoded list.
//
//go:embed grammar/*.json
var grammarFS embed.FS

type curriculumFile struct {
	Categories []struct {
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Topics      []struct {
			Slug             string   `json:"slug"`
			Name             string   `json:"name"`
			Description      string   `json:"description"`
			Level            string   `json:"level"`
			CEFRLevels       []string `json:"cefr_levels"`
			Difficulty       float64  `json:"difficulty"`
			EstimatedMinutes int      `json:"estimated_minutes"`
			IELTSRelevant    bool     `json:"ielts_relevant"`
			Keywords         []string `json:"keywords"`
			Group            string   `json:"group"`
		} `json:"topics"`
	} `json:"categories"`
}

type relationsFile struct {
	Relations []struct {
		From      string `json:"from"`
		To        string `json:"to"`
		Kind      string `json:"kind"`
		Note      string `json:"note"`
		SortOrder int    `json:"sort_order"`
	} `json:"relations"`
	Comparisons []struct {
		Left    string          `json:"left"`
		Right   string          `json:"right"`
		Summary string          `json:"summary"`
		Rows    json.RawMessage `json:"rows"`
	} `json:"comparisons"`
}

type contentFile struct {
	Topics map[string]struct {
		Content   json.RawMessage `json:"content"`
		Questions []struct {
			Type        string          `json:"type"`
			Prompt      string          `json:"prompt"`
			Payload     json.RawMessage `json:"payload"`
			Answer      json.RawMessage `json:"answer"`
			Explanation string          `json:"explanation"`
			TargetRule  string          `json:"target_rule"`
			Difficulty  float64         `json:"difficulty"`
			Tags        []string        `json:"tags"`
		} `json:"questions"`
	} `json:"topics"`
}

// seedGrammar loads the curriculum. It is idempotent: topics are matched by slug, so
// running it again updates the curriculum in place rather than duplicating it.
func seedGrammar(ctx context.Context, pool *pgxpool.Pool) error {
	var curriculum curriculumFile
	if err := readGrammarJSON("grammar/curriculum.json", &curriculum); err != nil {
		return err
	}
	var relations relationsFile
	if err := readGrammarJSON("grammar/relations.json", &relations); err != nil {
		return err
	}
	var content contentFile
	if err := readGrammarJSON("grammar/content.json", &content); err != nil {
		return err
	}

	// Topics that are no longer in the curriculum are archived, never deleted: a learner's
	// progress on them is real, and a deletion would cascade it away.
	curriculumSlugs := []string{}
	topics := 0

	for catIndex, cat := range curriculum.Categories {
		if _, err := pool.Exec(ctx, `
			INSERT INTO grammar_categories (slug, name, description, sort_order, status)
			VALUES ($1, $2, $3, $4, 'published')
			ON CONFLICT (slug) DO UPDATE SET
				name = EXCLUDED.name, description = EXCLUDED.description,
				sort_order = EXCLUDED.sort_order, status = 'published'`,
			cat.Slug, cat.Name, cat.Description, catIndex+1); err != nil {
			return fmt.Errorf("grammar category %s: %w", cat.Slug, err)
		}

		groupOrder := map[string]int{}
		for topicIndex, t := range cat.Topics {
			if _, ok := groupOrder[t.Group]; !ok {
				groupOrder[t.Group] = len(groupOrder) + 1
			}
			description := t.Description
			if description == "" {
				description = t.Name + "."
			}
			if _, err := pool.Exec(ctx, `
				INSERT INTO grammar_topics
					(slug, name, description, level_id, sort_order, status, category_id,
					 group_label, group_order, cefr_levels, difficulty, keywords,
					 ielts_relevant, estimated_minutes, published_at)
				VALUES ($1, $2, $3, (SELECT id FROM levels WHERE code = $4), $5, 'published',
				        (SELECT id FROM grammar_categories WHERE slug = $6),
				        $7, $8, $9, $10, $11, $12, $13, now())
				ON CONFLICT (slug) DO UPDATE SET
					name = EXCLUDED.name, description = EXCLUDED.description,
					level_id = EXCLUDED.level_id, sort_order = EXCLUDED.sort_order,
					status = 'published', category_id = EXCLUDED.category_id,
					group_label = EXCLUDED.group_label, group_order = EXCLUDED.group_order,
					cefr_levels = EXCLUDED.cefr_levels, difficulty = EXCLUDED.difficulty,
					keywords = EXCLUDED.keywords, ielts_relevant = EXCLUDED.ielts_relevant,
					estimated_minutes = EXCLUDED.estimated_minutes,
					published_at = COALESCE(grammar_topics.published_at, now())`,
				t.Slug, t.Name, description, t.Level, topicIndex+1, cat.Slug,
				t.Group, groupOrder[t.Group], t.CEFRLevels, t.Difficulty, t.Keywords,
				t.IELTSRelevant, t.EstimatedMinutes); err != nil {
				return fmt.Errorf("grammar topic %s: %w", t.Slug, err)
			}
			curriculumSlugs = append(curriculumSlugs, t.Slug)
			topics++
		}
	}

	archived, err := pool.Exec(ctx, `
		UPDATE grammar_topics SET status = 'archived'
		WHERE status = 'published' AND NOT (slug = ANY($1))`, curriculumSlugs)
	if err != nil {
		return fmt.Errorf("archive superseded grammar topics: %w", err)
	}

	for _, r := range relations.Relations {
		if _, err := pool.Exec(ctx, `
			INSERT INTO grammar_relations (from_topic_id, to_topic_id, kind, note, sort_order)
			SELECT f.id, t.id, $3, $4, $5
			FROM grammar_topics f, grammar_topics t
			WHERE f.slug = $1 AND t.slug = $2
			ON CONFLICT (from_topic_id, to_topic_id, kind) DO UPDATE SET
				note = EXCLUDED.note, sort_order = EXCLUDED.sort_order`,
			r.From, r.To, r.Kind, r.Note, r.SortOrder); err != nil {
			return fmt.Errorf("grammar relation %s→%s: %w", r.From, r.To, err)
		}
	}

	for _, cmp := range relations.Comparisons {
		if _, err := pool.Exec(ctx, `
			INSERT INTO grammar_comparisons (left_topic_id, right_topic_id, summary, rows, status)
			SELECT l.id, r.id, $3, $4, 'published'
			FROM grammar_topics l, grammar_topics r
			WHERE l.slug = $1 AND r.slug = $2
			ON CONFLICT (left_topic_id, right_topic_id) DO UPDATE SET
				summary = EXCLUDED.summary, rows = EXCLUDED.rows, status = 'published'`,
			cmp.Left, cmp.Right, cmp.Summary, cmp.Rows); err != nil {
			return fmt.Errorf("grammar comparison %s vs %s: %w", cmp.Left, cmp.Right, err)
		}
	}

	withContent, questions := 0, 0
	for slug, entry := range content.Topics {
		// Seeded explanations are English, written at the topic's own CEFR level — content
		// is keyed by (topic, language, level) since 000026, and the seed file carries one
		// explanation per topic.
		if _, err := pool.Exec(ctx, `
			INSERT INTO grammar_content (grammar_topic_id, language, level_code, body, schema_version,
			                             version, status, source, published_at)
			SELECT t.id, 'en', COALESCE(l.code, 'B1'), $2, 1, 1, 'published', 'curated', now()
			FROM grammar_topics t LEFT JOIN levels l ON l.id = t.level_id
			WHERE t.slug = $1
			ON CONFLICT (grammar_topic_id, language, level_code) WHERE status = 'published'
			DO UPDATE SET body = EXCLUDED.body, version = grammar_content.version + 1, published_at = now()`,
			slug, entry.Content); err != nil {
			return fmt.Errorf("grammar content %s: %w", slug, err)
		}
		withContent++

		// Questions are replaced rather than merged: they have no stable identity in the
		// file, and a learner's answers reference the question row, not its text. Archiving
		// the old ones keeps those answers readable.
		if _, err := pool.Exec(ctx, `
			UPDATE grammar_questions SET status = 'archived'
			WHERE source = 'curated' AND status = 'published'
			  AND grammar_topic_id = (SELECT id FROM grammar_topics WHERE slug = $1)
			  AND NOT EXISTS (SELECT 1 FROM grammar_answers a WHERE a.grammar_question_id = grammar_questions.id)`,
			slug); err != nil {
			return fmt.Errorf("archive grammar questions %s: %w", slug, err)
		}

		for _, q := range entry.Questions {
			tags := q.Tags
			if tags == nil {
				tags = []string{}
			}
			if _, err := pool.Exec(ctx, `
				INSERT INTO grammar_questions
					(grammar_topic_id, type, level_id, difficulty, prompt, payload, answer,
					 explanation, target_rule, tags, source, status)
				SELECT t.id, $2, t.level_id, $3, $4, $5, $6, $7, $8, $9, 'curated', 'published'
				FROM grammar_topics t
				WHERE t.slug = $1
				  AND NOT EXISTS (
				      -- The payload is part of the identity: every error-correction question
				      -- shares the prompt "Correct the mistake." and differs only in its sentence.
				      SELECT 1 FROM grammar_questions q
				      WHERE q.grammar_topic_id = t.id AND q.type = $2 AND q.prompt = $4
				        AND q.payload = $5 AND q.status = 'published')`,
				slug, q.Type, q.Difficulty, q.Prompt, q.Payload, q.Answer,
				q.Explanation, q.TargetRule, tags); err != nil {
				return fmt.Errorf("grammar question %s (%s): %w", slug, q.Type, err)
			}
			questions++
		}
	}

	fmt.Printf("grammar ready: %d categories, %d topics (%d archived), %d relations, %d comparisons, %d topics with content, %d questions\n",
		len(curriculum.Categories), topics, archived.RowsAffected(),
		len(relations.Relations), len(relations.Comparisons), withContent, questions)
	return nil
}

func readGrammarJSON(name string, dst any) error {
	raw, err := grammarFS.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("parse %s: %w", name, err)
	}
	return nil
}
