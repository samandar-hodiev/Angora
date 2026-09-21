-- Notification templates and delivery preferences.
--
-- The notifications table has existed since 000008; what was missing was any way for the
-- people running the platform to decide what those notifications say. Text that reaches a
-- learner is product copy, and product copy belongs in a table an owner can edit, not in a
-- Go string literal that needs a deploy to fix a typo.
--
-- Templates are keyed by (code, locale). The code is what application code refers to and
-- never changes; the locale is chosen from the learner's own native_language, falling back
-- to English, so a learner who set Uzbek gets Uzbek and nobody gets an empty message.

CREATE TABLE notification_templates (
    code        TEXT        NOT NULL,
    locale      TEXT        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'uz', 'ru')),
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    -- Channels this template is allowed to use. A learner's own preference can switch a
    -- channel off, never on: the template decides what is appropriate to email at all.
    in_app      BOOLEAN     NOT NULL DEFAULT true,
    email       BOOLEAN     NOT NULL DEFAULT false,
    subject     TEXT        NOT NULL,
    body        TEXT        NOT NULL,
    -- Placeholders the body may use, written as {{name}}. Stored so the editor can show
    -- what is available and warn about a placeholder that will never be filled.
    variables   TEXT[]      NOT NULL DEFAULT '{}',
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    updated_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (code, locale)
);

CREATE TRIGGER notification_templates_set_updated_at BEFORE UPDATE ON notification_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notification_preferences (
    user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    in_app     BOOLEAN     NOT NULL DEFAULT true,
    email      BOOLEAN     NOT NULL DEFAULT true,
    -- Template codes this learner has switched off individually.
    muted      TEXT[]      NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which template produced a notification: needed to answer "why did this learner get this
-- message", and to stop a scheduled reminder being sent twice in one day.
ALTER TABLE notifications ADD COLUMN template_code TEXT;
CREATE INDEX notifications_template_idx ON notifications (user_id, template_code, created_at DESC);

INSERT INTO notification_templates (code, locale, name, description, in_app, email, subject, body, variables) VALUES
    ('welcome', 'en', 'Welcome', 'Sent once, after the account is verified.', true, true,
     'Welcome to Engora, {{name}}',
     'Your account is ready. Start with a short placement test so your lessons match the level you are actually at.',
     ARRAY['name']),
    ('welcome', 'uz', 'Xush kelibsiz', 'Hisob tasdiqlangandan keyin bir marta yuboriladi.', true, true,
     'Engora''ga xush kelibsiz, {{name}}',
     'Hisobingiz tayyor. Darslar darajangizga mos bo''lishi uchun qisqa joylashtiruv testidan boshlang.',
     ARRAY['name']),
    ('welcome', 'ru', 'Добро пожаловать', 'Отправляется один раз после подтверждения аккаунта.', true, true,
     'Добро пожаловать в Engora, {{name}}',
     'Аккаунт готов. Начните с короткого теста уровня, чтобы занятия соответствовали вашему уровню.',
     ARRAY['name']),

    ('payment_succeeded', 'en', 'Payment received', 'Sent when a payment is confirmed by the provider.', true, true,
     'Payment received — {{plan}}',
     'We received {{amount}} {{currency}} for {{plan}}. Your subscription is active.',
     ARRAY['plan', 'amount', 'currency']),
    ('payment_succeeded', 'uz', 'To''lov qabul qilindi', 'To''lov provayder tomonidan tasdiqlanganda yuboriladi.', true, true,
     'To''lov qabul qilindi — {{plan}}',
     '{{plan}} uchun {{amount}} {{currency}} qabul qilindi. Obunangiz faollashtirildi.',
     ARRAY['plan', 'amount', 'currency']),
    ('payment_succeeded', 'ru', 'Платёж получен', 'Отправляется после подтверждения платежа провайдером.', true, true,
     'Платёж получен — {{plan}}',
     'Мы получили {{amount}} {{currency}} за {{plan}}. Подписка активна.',
     ARRAY['plan', 'amount', 'currency']),

    ('subscription_expiring', 'en', 'Subscription ending', 'Sent three days before a paid period ends.', true, true,
     'Your {{plan}} plan ends in {{days}} days',
     'Renew to keep the AI coach, unlimited practice and your mock exams.',
     ARRAY['plan', 'days']),
    ('subscription_expiring', 'uz', 'Obuna tugayapti', 'Pullik davr tugashiga uch kun qolganda yuboriladi.', true, true,
     '{{plan}} rejangiz {{days}} kundan keyin tugaydi',
     'AI murabbiy, cheksiz amaliyot va mock imtihonlar saqlanib qolishi uchun obunani yangilang.',
     ARRAY['plan', 'days']),
    ('subscription_expiring', 'ru', 'Подписка заканчивается', 'Отправляется за три дня до конца оплаченного периода.', true, true,
     'Ваш план {{plan}} заканчивается через {{days}} дн.',
     'Продлите подписку, чтобы сохранить AI-коуча, безлимитную практику и пробные экзамены.',
     ARRAY['plan', 'days']),

    ('level_changed', 'en', 'Level updated', 'Sent when an assessment moves the learner''s CEFR level.', true, false,
     'Your level is now {{level}}',
     'Based on your latest results your level moved from {{previous}} to {{level}}. Your plan has been adjusted.',
     ARRAY['level', 'previous']),
    ('level_changed', 'uz', 'Daraja yangilandi', 'Baholash o''quvchining CEFR darajasini o''zgartirganda yuboriladi.', true, false,
     'Darajangiz endi {{level}}',
     'So''nggi natijalaringizga ko''ra darajangiz {{previous}} dan {{level}} ga o''zgardi. Rejangiz moslashtirildi.',
     ARRAY['level', 'previous']),
    ('level_changed', 'ru', 'Уровень обновлён', 'Отправляется, когда оценка меняет уровень CEFR.', true, false,
     'Ваш уровень теперь {{level}}',
     'По последним результатам ваш уровень изменился с {{previous}} на {{level}}. План занятий обновлён.',
     ARRAY['level', 'previous']),

    ('streak_reminder', 'en', 'Streak reminder', 'Sent when a learner with a live streak has not practised today.', true, false,
     'Keep your {{days}}-day streak',
     'Ten minutes of practice today keeps it going.',
     ARRAY['days']),
    ('streak_reminder', 'uz', 'Ketma-ketlik eslatmasi', 'Ketma-ketligi bor o''quvchi bugun shug''ullanmaganda yuboriladi.', true, false,
     '{{days}} kunlik ketma-ketligingizni saqlang',
     'Bugun o''n daqiqalik amaliyot uni davom ettiradi.',
     ARRAY['days']),
    ('streak_reminder', 'ru', 'Напоминание о серии', 'Отправляется, если ученик с активной серией сегодня не занимался.', true, false,
     'Сохраните серию из {{days}} дн.',
     'Десять минут практики сегодня — и серия продолжается.',
     ARRAY['days']),

    ('assessment_completed', 'en', 'Assessment ready', 'Sent when a placement test has finished scoring.', true, false,
     'Your assessment result is ready',
     'You scored {{score}} overall ({{level}}). Open your results to see what to work on first.',
     ARRAY['score', 'level']),
    ('assessment_completed', 'uz', 'Baholash tayyor', 'Joylashtiruv testi baholanib bo''lganda yuboriladi.', true, false,
     'Baholash natijangiz tayyor',
     'Umumiy natijangiz {{score}} ({{level}}). Nimadan boshlash kerakligini ko''rish uchun natijalarni oching.',
     ARRAY['score', 'level']),
    ('assessment_completed', 'ru', 'Результат готов', 'Отправляется после подсчёта результатов теста уровня.', true, false,
     'Результат оценки готов',
     'Ваш общий балл {{score}} ({{level}}). Откройте результаты, чтобы увидеть, с чего начать.',
     ARRAY['score', 'level']);
