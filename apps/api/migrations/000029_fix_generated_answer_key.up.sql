-- Repairing AI-written practice that could not be marked.
--
-- internal/grammar marks a multiple-choice answer by reading answer->>'correct_index'. The
-- generator wrote answer->>'index' instead, so every question it produced was unmarkable:
-- the console showed a correct answer, the learner picked it, and the scorer found no key
-- and returned nothing. The generator now writes the right name; these are the rows it
-- already wrote.
--
-- Only rows that have the wrong key and not the right one are touched, so a question an
-- editor has since fixed by hand is left exactly as it is.

UPDATE grammar_questions
SET answer = (answer - 'index') || jsonb_build_object('correct_index', (answer ->> 'index')::int)
WHERE answer ? 'index'
  AND NOT (answer ? 'correct_index')
  AND (answer ->> 'index') ~ '^[0-9]+$';
