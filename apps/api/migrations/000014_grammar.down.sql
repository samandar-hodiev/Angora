DROP TABLE IF EXISTS grammar_ai_explanations;
DROP TABLE IF EXISTS grammar_visuals;

DROP INDEX IF EXISTS mistakes_grammar_topic_idx;
ALTER TABLE mistakes DROP COLUMN IF EXISTS grammar_topic_id;

DROP TABLE IF EXISTS grammar_user_errors;

ALTER TABLE user_grammar_progress
    DROP COLUMN IF EXISTS understanding,
    DROP COLUMN IF EXISTS practice,
    DROP COLUMN IF EXISTS application,
    DROP COLUMN IF EXISTS state,
    DROP COLUMN IF EXISTS opened_at,
    DROP COLUMN IF EXISTS explained_at,
    DROP COLUMN IF EXISTS visual_viewed_at,
    DROP COLUMN IF EXISTS mastered_at;

DROP TABLE IF EXISTS grammar_answers;
DROP TABLE IF EXISTS grammar_attempts;
DROP TABLE IF EXISTS grammar_questions;
DROP TABLE IF EXISTS grammar_comparisons;
DROP TABLE IF EXISTS grammar_relations;
DROP TABLE IF EXISTS grammar_content;

DROP INDEX IF EXISTS grammar_topics_search_idx;
DROP INDEX IF EXISTS grammar_topics_keywords_idx;
DROP INDEX IF EXISTS grammar_topics_category_idx;
DROP INDEX IF EXISTS grammar_topics_cefr_idx;

ALTER TABLE grammar_topics
    DROP COLUMN IF EXISTS search_document,
    DROP COLUMN IF EXISTS category_id,
    DROP COLUMN IF EXISTS group_label,
    DROP COLUMN IF EXISTS group_order,
    DROP COLUMN IF EXISTS cefr_levels,
    DROP COLUMN IF EXISTS difficulty,
    DROP COLUMN IF EXISTS keywords,
    DROP COLUMN IF EXISTS ielts_relevant,
    DROP COLUMN IF EXISTS estimated_minutes,
    DROP COLUMN IF EXISTS published_at;

DROP TABLE IF EXISTS grammar_categories;
