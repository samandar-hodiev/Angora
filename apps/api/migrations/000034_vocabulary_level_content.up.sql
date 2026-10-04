-- One word, explained for every level.
--
-- A word is one entry, but "consequence" means something different to explain to an A1
-- learner than to a C1 one: the A1 learner needs one plain sentence and an everyday example,
-- the C1 learner the collocations and the register. level_content holds that explanation per
-- CEFR level — {"A1": {"definition": "...", "examples": ["..."]}, ..., "C2": {...}} — and the
-- learner is shown the one for their own level. level_id stays what it was: how hard the word
-- itself is. definition and examples stay too, as the explanation at the word's own level,
-- for every reader written before this.
ALTER TABLE vocabulary ADD COLUMN level_content JSONB NOT NULL DEFAULT '{}'::jsonb;
