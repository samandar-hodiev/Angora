-- Grammar AI entitlements.
--
-- The grammar tutor, level-adapted explanations and generated visuals were shipped with a
-- per-hour rate limit (abuse protection) but no plan gate: every learner could reach them
-- regardless of what they pay for. These rows make them ordinary entitlements, so the same
-- Resolve/ConsumeUsage path that guards speaking and writing now guards grammar too.
--
-- Limits are monthly here rather than daily: grammar help is used in bursts while a learner
-- works through a topic, and a daily cap would refuse them mid-lesson.

INSERT INTO entitlements (key, kind, description) VALUES
    ('grammar.ai_explanation', 'limit',   'Grammar explanations rewritten for the learner''s level'),
    ('grammar.ai_tutor',       'feature', 'Follow-up questions to the AI grammar tutor'),
    ('grammar.ai_questions',   'limit',   'Questions asked of the AI grammar tutor'),
    ('grammar.visualize',      'feature', 'Generated diagrams for a grammar rule'),
    ('grammar.visuals',        'limit',   'Grammar visuals generated')
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
SELECT p.id, v.key, v.limit_value, v.limit_period
FROM (VALUES
    -- Free learners get a taste of the level-adapted explanation and nothing else; the
    -- tutor and visuals are the paid part of the grammar experience.
    ('free',      'grammar.ai_explanation', 5,    'month'),

    ('pro',       'grammar.ai_explanation', 100,  'month'),
    ('pro',       'grammar.ai_tutor',       NULL, NULL),
    ('pro',       'grammar.ai_questions',   200,  'month'),
    ('pro',       'grammar.visualize',      NULL, NULL),
    ('pro',       'grammar.visuals',        40,   'month'),

    -- IELTS Pro is the unlimited tier: the feature rows grant access and the absent limit
    -- rows mean no cap.
    ('ielts_pro', 'grammar.ai_explanation', NULL, 'month'),
    ('ielts_pro', 'grammar.ai_tutor',       NULL, NULL),
    ('ielts_pro', 'grammar.ai_questions',   NULL, 'month'),
    ('ielts_pro', 'grammar.visualize',      NULL, NULL),
    ('ielts_pro', 'grammar.visuals',        NULL, 'month')
) AS v(plan_code, key, limit_value, limit_period)
JOIN subscription_plans p ON p.code = v.plan_code
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;
