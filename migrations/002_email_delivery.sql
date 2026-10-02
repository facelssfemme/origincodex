-- Provider IDs only. Receipt is stored independently so delivery-before-email-save races are safe.
CREATE TABLE IF NOT EXISTS syrena_email_delivery (
  email_id uuid PRIMARY KEY,
  delivered_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
