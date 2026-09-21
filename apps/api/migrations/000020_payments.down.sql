DROP TABLE IF EXISTS payment_callbacks;
DROP TABLE IF EXISTS payment_transactions;
DROP SEQUENCE IF EXISTS payment_prepare_id_seq;
ALTER TABLE subscription_plans DROP COLUMN IF EXISTS price_uzs;
