import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuizData {
  name: string;
  archetype: string;
  secondaryArchetype: string;
  sunSign: string;
  includeShadow: boolean;
  answers?: Record<string, unknown>;
}

interface SaveSessionResult {
  token: string;
}

interface RetrieveSessionResult {
  quizData?: QuizData;
  error?: string;
}

// ─── Save Quiz Session ───────────────────────────────────────────────────────

/**
 * Stores quiz data in the database and returns a one-time access token.
 * Called by the quiz page before redirecting to Stripe checkout.
 */
export const saveQuizSession = createServerFn({ method: "POST" })
  .validator((d: QuizData) => d)
  .handler(async ({ data }) => {
    const token = crypto.randomUUID();

    // Ensure the table exists
    await sql()`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        token TEXT PRIMARY KEY,
        quiz_data JSONB NOT NULL,
        consumed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;

    // Insert the session
    await sql()`
      INSERT INTO quiz_sessions (token, quiz_data, consumed, created_at)
      VALUES (${token}, ${JSON.stringify(data)}::jsonb, false, NOW());
    `;

    return { token } as SaveSessionResult;
  });

// ─── Retrieve Quiz Session (one-time use) ────────────────────────────────────

/**
 * Retrieves quiz data by token. Marks the session as consumed on success.
 * Tokens expire after 24 hours. One-time use only.
 * Called by the thank-you page after Stripe redirects back.
 */
export const retrieveQuizSession = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data;

    if (!token || typeof token !== "string") {
      return { error: "Invalid session token" } as RetrieveSessionResult;
    }

    // Ensure the table exists
    await sql()`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        token TEXT PRIMARY KEY,
        quiz_data JSONB NOT NULL,
        consumed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;

    // Look up the session — must be unconsumed and within 24 hours
    const rows = await sql()`
      SELECT token, quiz_data, consumed, created_at
      FROM quiz_sessions
      WHERE token = ${token}
        AND consumed = false
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1;
    `;

    if (rows.length === 0) {
      return { error: "Invalid or expired session" } as RetrieveSessionResult;
    }

    // Mark as consumed (one-time use)
    await sql()`
      UPDATE quiz_sessions
      SET consumed = true
      WHERE token = ${token};
    `;

    const quizData = rows[0].quiz_data as QuizData;

    return { quizData } as RetrieveSessionResult;
  });
