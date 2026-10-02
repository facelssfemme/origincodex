-- Apply only to a dedicated Syrena test database after review. Never run at request time.
CREATE TABLE IF NOT EXISTS syrena_orders (
  id uuid PRIMARY KEY,
  data jsonb NOT NULL,
  stripe_session_id text GENERATED ALWAYS AS (data->>'sessionId') STORED UNIQUE,
  lease uuid,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'currency' = 'usd')
);
CREATE INDEX IF NOT EXISTS syrena_orders_pending ON syrena_orders ((data->>'stage'));
