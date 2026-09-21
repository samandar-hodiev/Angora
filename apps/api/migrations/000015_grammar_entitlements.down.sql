DELETE FROM plan_entitlements WHERE entitlement_key IN (
    'grammar.ai_explanation', 'grammar.ai_tutor', 'grammar.ai_questions',
    'grammar.visualize', 'grammar.visuals');

DELETE FROM entitlements WHERE key IN (
    'grammar.ai_explanation', 'grammar.ai_tutor', 'grammar.ai_questions',
    'grammar.visualize', 'grammar.visuals');
