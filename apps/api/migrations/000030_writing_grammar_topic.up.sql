-- Writing practice set for a grammar topic.
--
-- A learner who finishes A / An and presses "Writing" is given a task written for that topic,
-- not one from the library, so the submission has no content item to read its prompt from.
-- It keeps the prompt it answered and the topic it practised: the history can say what was
-- written, and the topic can be credited with the evidence.

ALTER TABLE writing_submissions
    ADD COLUMN prompt TEXT NOT NULL DEFAULT '',
    ADD COLUMN grammar_topic_id UUID REFERENCES grammar_topics (id) ON DELETE SET NULL;

CREATE INDEX writing_submissions_grammar_topic_idx
    ON writing_submissions (user_id, grammar_topic_id)
    WHERE grammar_topic_id IS NOT NULL;
