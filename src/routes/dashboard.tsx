import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAnalytics } from "~/server/analytics";
export const Route = createFileRoute("/dashboard")({ component: Dashboard });
function Dashboard() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof getAnalytics>
  > | null>(null);
  const [message, setMessage] = useState(
    "Enter the reporting access key to load verified counts.",
  );
  return (
    <main className="min-h-dvh cosmic-gradient text-white p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <h1 className="text-2xl">Syrena funnel report</h1>
        <form
          method="POST"
          className="flex flex-wrap gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = new FormData(form);
            setReport(null);
            setMessage("Loading…");
            try {
              const result = await getAnalytics({
                data: {
                  from: String(values.get("from")),
                  to: String(values.get("to")),
                  environment: values.get("environment") as "test" | "live",
                  secret: String(values.get("secret")),
                },
              });
              setReport(result);
              setMessage("Loaded from persistent records.");
            } catch {
              setMessage(
                "Report unavailable. Check access, dates, and reporting configuration; unavailable data is not zero.",
              );
            }
            (form.elements.namedItem("secret") as HTMLInputElement).value = "";
          }}
        >
          <label>
            From (UTC)
            <input
              className="block bg-slate-800 p-2"
              name="from"
              type="date"
              required
            />
          </label>
          <label>
            Through (UTC)
            <input
              className="block bg-slate-800 p-2"
              name="to"
              type="date"
              required
            />
          </label>
          <label>
            Environment
            <select className="block bg-slate-800 p-2" name="environment">
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label>
            Access key
            <input
              className="block bg-slate-800 p-2"
              name="secret"
              disabled={!ready}
              type="password"
              autoComplete="off"
              required
            />
          </label>
          <button disabled={!ready} className="glow-button p-3 rounded-xl">
            Load report
          </button>
        </form>
        <p role="status">{message}</p>
        {report && (
          <>
            <p>{report.definitions}</p>
            <h2>Verified order cohort · {report.environment}</h2>
            <dl>
              {Object.entries(report.orders).map(([key, value]) => (
                <div key={key}>
                  {key.replaceAll("_", " ")}: <strong>{String(value)}</strong>
                </div>
              ))}
            </dl>
            <h2>Observed browser stages</h2>
            <ul>
              {report.browser.map((row, i) => (
                <li key={i}>
                  {String(row.name)}
                  {row.question ? ` · question ${row.question}` : ""}:{" "}
                  {String(row.sessions)} sessions
                </li>
              ))}
            </ul>
            {!report.browser.length && (
              <p>No observations recorded in this range.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
