package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type topicSeed struct{ slug, name string }

var topics = []topicSeed{
	{"daily-life", "Daily life"}, {"travel", "Travel"}, {"work", "Work & careers"},
	{"education", "Education"}, {"technology", "Technology"}, {"environment", "Environment"},
	{"health", "Health"}, {"culture", "Culture & people"},
}

type wordSeed struct {
	term, pos, definition, ipa, level string
	examples                          []string
	tags                              []string
}

var words = []wordSeed{
	{"nevertheless", "adverb", "despite what has just been said", "/ˌnevəðəˈles/", "B2", []string{"The route was long; nevertheless, we arrived on time."}, []string{"linking"}},
	{"meanwhile", "adverb", "at the same time as something else is happening", "/ˈmiːnwaɪl/", "B1", []string{"I cooked dinner. Meanwhile, my brother set the table."}, []string{"linking"}},
	{"reluctant", "adjective", "not willing to do something", "/rɪˈlʌktənt/", "B2", []string{"She was reluctant to speak in front of the class."}, nil},
	{"consequence", "noun", "a result of an action or situation", "/ˈkɒnsɪkwəns/", "B1", []string{"Missing the bus had one consequence: I was late."}, nil},
	{"approach", "noun", "a way of dealing with something", "/əˈprəʊtʃ/", "B1", []string{"We need a new approach to learning vocabulary."}, []string{"academic"}},
	{"significant", "adjective", "large or important enough to be noticed", "/sɪɡˈnɪfɪkənt/", "B1", []string{"There was a significant improvement in her speaking."}, []string{"academic"}},
	{"accomplish", "verb", "to succeed in doing something", "/əˈkʌmplɪʃ/", "B2", []string{"You can accomplish a lot in fifteen minutes a day."}, nil},
	{"commute", "verb", "to travel regularly between home and work", "/kəˈmjuːt/", "B1", []string{"I commute by train and listen to podcasts."}, []string{"work"}},
	{"sustainable", "adjective", "able to continue without causing damage", "/səˈsteɪnəbl/", "B2", []string{"Cities are investing in sustainable transport."}, []string{"environment"}},
	{"thorough", "adjective", "careful and complete", "/ˈθʌrə/", "B2", []string{"She gave my essay a thorough review."}, nil},
	{"eventually", "adverb", "in the end, after a long time", "/ɪˈventʃuəli/", "B1", []string{"Eventually, speaking English felt natural."}, nil},
	{"overwhelming", "adjective", "very great or strong; difficult to deal with", "/ˌəʊvəˈwelmɪŋ/", "C1", []string{"The amount of new vocabulary felt overwhelming at first."}, nil},
}

type contentSeed struct {
	typ, title, skill, level, topic string
	exam                            *string
	difficulty                      int
	tags                            []string
	body                            map[string]any
}

var ielts = "ielts"

var content = []contentSeed{
	{"speaking_topic", "Describe your hometown", "speaking", "B1", "daily-life", nil, 4, []string{"describing places"},
		map[string]any{
			"prompt":              "Describe your hometown. Where is it, what is it like, and what do you like most about it?",
			"guidance":            []string{"Where it is and how big it is", "What people do there", "A place you would recommend", "How it has changed"},
			"preparation_seconds": 30, "speaking_seconds": 120,
		}},
	{"speaking_topic", "Talk about a memorable trip", "speaking", "B1", "travel", nil, 5, []string{"past narrative"},
		map[string]any{
			"prompt":              "Talk about a trip you remember well. Where did you go, who were you with, and why was it memorable?",
			"guidance":            []string{"When and where it was", "What you did", "Something unexpected", "How you felt"},
			"preparation_seconds": 30, "speaking_seconds": 120,
		}},
	{"speaking_topic", "Your ideal job", "speaking", "B2", "work", nil, 6, []string{"opinions", "future"},
		map[string]any{
			"prompt":              "Describe your ideal job. What would you do every day, and why would it suit you?",
			"guidance":            []string{"The role and the workplace", "Skills it needs", "Why it suits you", "Any drawbacks"},
			"preparation_seconds": 45, "speaking_seconds": 120,
		}},
	{"speaking_topic", "Describe a book you enjoyed", "speaking", "B2", "education", &ielts, 6, []string{"ielts part 2", "cue card"},
		map[string]any{
			"prompt":              "Describe a book you enjoyed reading. You should say what the book was, when you read it, what it was about, and explain why you enjoyed it.",
			"guidance":            []string{"What the book was", "When you read it", "What it was about", "Why you enjoyed it"},
			"preparation_seconds": 60, "speaking_seconds": 120,
		}},
	{"writing_task", "Email to a friend about your weekend", "writing", "A2", "daily-life", nil, 3, []string{"informal email"},
		map[string]any{
			"prompt":       "Write an email to a friend telling them about your weekend. Say what you did, who you met and what you enjoyed most.",
			"instructions": []string{"Start with a friendly greeting", "Use the past simple", "Ask your friend a question at the end"},
			"min_words":    80, "recommended_minutes": 15,
		}},
	{"writing_task", "Should university education be free?", "writing", "B2", "education", &ielts, 7, []string{"opinion essay", "task 2"},
		map[string]any{
			"prompt":       "Some people believe university education should be free for everyone. Others think students should pay. Discuss both views and give your own opinion.",
			"instructions": []string{"Discuss both views", "Give a clear opinion", "Support ideas with examples", "Organise ideas into paragraphs"},
			"min_words":    250, "recommended_minutes": 40,
		}},
	{"reading_passage", "The four-day work week", "reading", "B1", "work", nil, 5, []string{"work", "society"},
		map[string]any{
			"estimated_minutes": 6,
			"passage": "In recent years, a growing number of companies have experimented with a four-day work week. " +
				"Employees work fewer hours but, in most trials, receive the same salary.\n\n" +
				"Supporters say the change makes people happier and more focused. With an extra day off, workers have more time " +
				"for family, exercise and rest, and many return to work with more energy. Some companies also report fewer sick days.\n\n" +
				"Critics are less convinced. They point out that not every job can be done in four days: hospitals, shops and schools " +
				"need people every day. Others worry that squeezing the same work into fewer days could increase stress.\n\n" +
				"The results so far are mixed, but one thing is clear: many workers now expect more flexibility than before.",
			"questions": []map[string]any{
				{"id": "q1", "prompt": "In most trials, what happens to salaries?", "options": []string{"They go down", "They stay the same", "They go up", "They are replaced by bonuses"}},
				{"id": "q2", "prompt": "Which benefit do some companies report?", "options": []string{"Longer meetings", "Fewer sick days", "Higher prices", "More overtime"}},
				{"id": "q3", "prompt": "Why are critics unconvinced?", "options": []string{"Salaries are too high", "Some jobs need people every day", "Workers dislike free time", "Offices are too small"}},
				{"id": "q4", "prompt": "What is the writer's conclusion?", "options": []string{"The idea has failed", "Everyone should adopt it now", "Results are mixed but expectations have changed", "Only hospitals benefit"}},
			},
		}},
	{"listening_exercise", "Booking a table", "listening", "A2", "daily-life", nil, 3, []string{"phone call", "restaurant"},
		map[string]any{
			"audio_url":        nil,
			"duration_seconds": 75,
			"transcript": "Hello, Bella Cucina. — Hi, I'd like to book a table for Friday evening, please. — Of course. For how many people? " +
				"— Four. — And what time? — Around half past seven. — Let me check... Yes, 7:30 is fine. Can I have your name? — It's Karimova. " +
				"— Thank you. Would you like a table inside or on the terrace? — Inside, please. It might be cold.",
			"questions": []map[string]any{
				{"id": "q1", "prompt": "Which day is the booking for?", "options": []string{"Thursday", "Friday", "Saturday", "Sunday"}},
				{"id": "q2", "prompt": "How many people is the table for?", "options": []string{"Two", "Three", "Four", "Five"}},
				{"id": "q3", "prompt": "Where does the caller want to sit?", "options": []string{"On the terrace", "By the window", "Inside", "At the bar"}},
			},
		}},
}

func seedContent(ctx context.Context, pool *pgxpool.Pool) error {
	for _, t := range topics {
		if _, err := pool.Exec(ctx, `INSERT INTO topics (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING`, t.slug, t.name); err != nil {
			return fmt.Errorf("topic %s: %w", t.slug, err)
		}
	}
	for _, w := range words {
		tags := w.tags
		if tags == nil {
			tags = []string{}
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags, status)
			VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, 'published')
			ON CONFLICT (lower(term), part_of_speech) DO NOTHING`,
			w.term, w.pos, w.definition, w.examples, w.ipa, w.level, tags); err != nil {
			return fmt.Errorf("word %s: %w", w.term, err)
		}
	}
	inserted := 0
	for _, ci := range content {
		tag, err := pool.Exec(ctx, `
			INSERT INTO content_items (type, title, skill_id, level_id, topic_id, exam, difficulty, tags, status, body, published_at)
			SELECT $1, $2, (SELECT id FROM skills WHERE code = $3), (SELECT id FROM levels WHERE code = $4),
			       (SELECT id FROM topics WHERE slug = $5), $6, $7, $8, 'published', $9, now()
			WHERE NOT EXISTS (SELECT 1 FROM content_items WHERE type = $1 AND title = $2)`,
			ci.typ, ci.title, ci.skill, ci.level, ci.topic, ci.exam, ci.difficulty, ci.tags, ci.body)
		if err != nil {
			return fmt.Errorf("content %q: %w", ci.title, err)
		}
		inserted += int(tag.RowsAffected())
	}
	fmt.Printf("content ready: %d topics, %d words, %d content items (%d new)\n",
		len(topics), len(words), len(content), inserted)
	return nil
}
