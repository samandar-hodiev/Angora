DELETE FROM plan_entitlements WHERE entitlement_key = 'speaking.live_coach';
DELETE FROM entitlements WHERE key = 'speaking.live_coach';
DROP TABLE IF EXISTS speaking_turns;
