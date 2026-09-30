-- Anonymous best-effort browser observations; no answers, names, email, URLs, or tokens.
CREATE TABLE IF NOT EXISTS syrena_funnel_events (
  event_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','live')),
  name text NOT NULL CHECK (name IN ('landing_view','quiz_start','quiz_question_complete','quiz_complete','paywall_view','checkout_redirect_requested','paywall_exit','checkout_return')),
  question integer CHECK (question BETWEEN 1 AND 9),
  device text NOT NULL CHECK (device IN ('desktop','mobile','tablet','unknown')),
  source text NOT NULL CHECK (source IN ('direct','tiktok','instagram','facebook','google','social','other')),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS syrena_funnel_range ON syrena_funnel_events(environment,received_at);
-- Provider IDs only. Receipt is stored independently so delivery-before-email-save races are safe.
CREATE TABLE IF NOT EXISTS syrena_email_delivery (
  email_id uuid PRIMARY KEY,
  delivered_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
