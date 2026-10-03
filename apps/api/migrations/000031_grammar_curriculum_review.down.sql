-- The topics this added go back to being archived, and the duplicates it archived come back
-- as drafts. Placement is not restored: the previous order was the problem being fixed.
UPDATE grammar_topics SET status = 'archived'
WHERE status <> 'published' AND slug IN ('to-be', 'imperatives', 'there-is-there-are', 'have-got', 'like-want-would-like', 'used-to', 'be-get-used-to', 'one-ones', 'partitives', 'other-another', 'no-none', 'present-simple-vs-continuous', 'past-simple-vs-present-perfect', 'narrative-tenses', 'future-forms-compared', 'future-in-the-past', 'be-able-to', 'had-better', 'modals-of-deduction', 'would-rather', 'short-answers', 'subject-object-questions', 'so-neither', 'adjectives-basics', 'still-yet-already', 'so-such', 'time-clauses', 'purpose-clauses', 'discourse-markers', 'wish-if-only', 'passive-reporting', 'ellipsis-substitution', 'nominalisation', 'participle-clauses', 'cleft-sentences', 'subjunctive');

UPDATE grammar_topics SET status = 'draft'
WHERE status = 'archived' AND slug IN ('comparative-adj', 'superlative-adj', 'adjective-order-wo', 'adverb-position', 'relative-clauses-overview', 'conditional-clauses', 'state-action-verbs', 'unless-conj', 'relative-pronouns', 'demonstrative-pronouns', 'more-most', 'regular-plurals', 'a-few-a-little');
