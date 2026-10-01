import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAnalytics, type AnalyticsReport } from "~/server/analytics";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

/** Internal funnel analytics dashboard. Powered by the JSONL event log. */

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type RangeKey = "today" | "7d" | "30d" | "all" | "custom";

const RANGE_PRESETS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

function defaultRange(): { key: RangeKey; from: string; to: string } {
  return { key: "30d", from: toDateStr(new Date(Date.now() - 29 * 86_400_000)), to: toDateStr(new Date()) };
}

function Bar({ pct, className = "bg-violet-500" }: { pct: number | null; className?: string }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="w-24 h-2 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
      <div
        className={`h-full rounded-full ${className} transition-all duration-500`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="cosmic-card rounded-2xl p-4 flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-widest text-gray-500/60">{label}</span>
      <span className="text-2xl font-light text-white">{value}</span>
      {sub && <span className="text-xs text-gray-500/50">{sub}</span>}
    </div>
  );
}

function Dashboard() {
  const [range, setRange] = useState(defaultRange());
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnalytics({
      data: {
        from: range.key === "all" ? undefined : range.from || undefined,
        to: range.key === "all" ? undefined : range.to || undefined,
      },
    })
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Failed to load analytics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const pickPreset = (key: RangeKey) => {
    const today = new Date();
    if (key === "today") setRange({ key, from: toDateStr(today), to: toDateStr(today) });
    else if (key === "7d") setRange({ key, from: toDateStr(new Date(today.getTime() - 6 * 86_400_000)), to: toDateStr(today) });
    else if (key === "30d") setRange({ key, from: toDateStr(new Date(today.getTime() - 29 * 86_400_000)), to: toDateStr(today) });
    else if (key === "all") setRange({ key, from: "", to: "" });
    // "custom" keeps whatever is typed in the date inputs
  };

  return (
    <main className="relative min-h-dvh px-4 py-10 cosmic-gradient overflow-hidden">
      <div className="relative z-10 max-w-3xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500/60 tracking-widest uppercase mb-1">
                ✦ Internal Analytics ✦
              </p>
              <h1 className="text-2xl sm:text-3xl font-light text-white">Funnel Dashboard</h1>
            </div>
            <span className="text-xs text-gray-500/50">
              {report ? `${report.uniqueSessions} sessions · ${report.totalEvents} events` : "—"}
            </span>
          </div>

          {/* Date range controls */}
          <div className="cosmic-card rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => pickPreset(p.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    range.key === p.key
                      ? "bg-violet-600/40 border border-violet-500/40 text-white"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="text-gray-500/60">From</label>
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, key: "custom", from: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-violet-500/50 [color-scheme:dark]"
              />
              <label className="text-gray-500/60">To</label>
              <input
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, key: "custom", to: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-violet-500/50 [color-scheme:dark]"
              />
              {report && (
                <span className="text-gray-500/50 ml-auto">
                  {report.range.from ?? "earliest"} → {report.range.to ?? "now"}
                </span>
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div className="cosmic-card rounded-2xl p-8 text-center">
            <p className="text-sm text-gray-400/70">Loading analytics…</p>
          </div>
        )}

        {error && (
          <div className="cosmic-card rounded-2xl p-8 text-center border-red-500/20">
            <p className="text-sm text-red-400/80">Failed to load analytics: {error}</p>
          </div>
        )}

        {report && !loading && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label="Sessions" value={String(report.uniqueSessions)} sub="anonymous session ids" />
              <StatCard
                label="Verified purchases"
                value={String(report.purchase.count)}
                sub={`${report.paywall.checkoutStartedSessions} started checkout`}
              />
              <StatCard
                label="Verified revenue"
                value={`${report.purchase.revenue.toFixed(2)}`}
                sub={`AOV ${report.purchase.avgOrderValue.toFixed(2)}`}
              />
              <StatCard label="Upsell rate" value={`${report.purchase.upsellRate}%`} sub={`${report.purchase.upsellCount} with Shadow Origin`} />
              <StatCard label="Paywall abandon" value={String(report.paywall.abandonedSessions)} sub={`${report.paywall.paymentAbandonedSessions} payment abandons`} />
              <StatCard
                label="Avg paywall duration"
                value={`${report.paywall.avgDurationSecBeforeAbandon.toFixed(1)}s`}
                sub="before abandonment"
              />
            </div>

            <p className="text-[11px] text-gray-500/60 leading-relaxed">
              <span className="text-gold/80">Verified revenue</span> counts only payments confirmed
              server-side against Stripe (paid Checkout Session, correct product, amount and quiz
              metadata). {report.purchase.legacyUnverifiedCount} legacy client-side purchase
              {report.purchase.legacyUnverifiedCount === 1 ? " event" : " events"} (${report.purchase.legacyUnverifiedRevenue.toFixed(2)}) excluded.
            </p>

            {/* Funnel */}
            <section className="cosmic-card rounded-2xl p-5 flex flex-col gap-3">
              <h2 className="text-sm text-white/80 font-medium tracking-wide">Funnel</h2>
              <div className="flex flex-col gap-2.5">
                {report.funnel.map((row, i) => (
                  <div key={row.step} className="flex items-center gap-3">
                    <span className="w-40 flex-shrink-0 text-xs text-gray-400/80 truncate" title={row.step}>
                      {i + 1}. {row.step.replaceAll("_", " ")}
                    </span>
                    <Bar pct={row.conversionFromPrev} />
                    <span className="w-14 text-right text-sm text-white tabular-nums">{row.count}</span>
                    <span className="w-16 text-right text-xs text-gray-500/60 tabular-nums">
                      {row.conversionFromPrev === null ? "—" : `${row.conversionFromPrev}%`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-600/60 mt-1">
                % = conversion from the previous step (unique sessions per step).
              </p>
            </section>

            {/* Per-question drop-off */}
            <section className="cosmic-card rounded-2xl p-5 flex flex-col gap-3">
              <h2 className="text-sm text-white/80 font-medium tracking-wide">
                Per-question drop-off
              </h2>
              <div className="flex flex-col gap-2">
                {report.questionDropoff.map((q) => (
                  <div key={q.question} className="flex items-center gap-3">
                    <span className="w-40 flex-shrink-0 text-xs text-gray-400/80">
                      Question {q.question}
                    </span>
                    <Bar pct={q.dropoffPct} className="bg-gold" />
                    <span className="w-14 text-right text-sm text-white tabular-nums">{q.count}</span>
                    <span className="w-16 text-right text-xs text-gray-500/60 tabular-nums">
                      {q.dropoffPct === null ? "—" : `${q.dropoffPct}%`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-600/60 mt-1">
                % = sessions retained from the previous question (7 traits + birthdate + email).
              </p>
            </section>

            {/* Paywall details */}
            <section className="cosmic-card rounded-2xl p-5 flex flex-col gap-3">
              <h2 className="text-sm text-white/80 font-medium tracking-wide">Paywall behavior</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Viewed paywall</span>
                  <span className="text-white text-base tabular-nums">{report.paywall.viewedSessions}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Left without paying</span>
                  <span className="text-white text-base tabular-nums">{report.paywall.abandonedSessions}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Clicked unlock</span>
                  <span className="text-white text-base tabular-nums">{report.paywall.checkoutStartedSessions}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Payment abandons</span>
                  <span className="text-red-300/80 text-base tabular-nums">{report.paywall.paymentAbandonedSessions}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Avg duration (abandon)</span>
                  <span className="text-white text-base tabular-nums">{report.paywall.avgDurationSecBeforeAbandon.toFixed(1)}s</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500/60">Avg scroll depth</span>
                  <span className="text-white text-base tabular-nums">{report.paywall.avgScrollPct.toFixed(1)}%</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-600/60 mt-1">
                Durations come from a 15s heartbeat + exit/purchase events, per-session max.
                Payment abandons = clicked unlock but never reached a Stripe-verified purchase.
              </p>
            </section>

            {/* Traffic sources + devices */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <section className="cosmic-card rounded-2xl p-5 flex flex-col gap-2">
                <h2 className="text-sm text-white/80 font-medium tracking-wide">Traffic sources</h2>
                {report.trafficSources.length === 0 ? (
                  <p className="text-xs text-gray-600/60">No events yet</p>
                ) : (
                  report.trafficSources.map((s) => (
                    <div key={s.source} className="flex items-center gap-3">
                      <span className="flex-1 text-xs text-gray-400/80 truncate">{s.source}</span>
                      <Bar pct={report.uniqueSessions ? Math.round((s.sessions / report.uniqueSessions) * 1000) / 10 : 0} />
                      <span className="w-10 text-right text-xs text-white tabular-nums">{s.sessions}</span>
                    </div>
                  ))
                )}
              </section>
              <section className="cosmic-card rounded-2xl p-5 flex flex-col gap-2">
                <h2 className="text-sm text-white/80 font-medium tracking-wide">Device split</h2>
                {report.deviceSplit.length === 0 ? (
                  <p className="text-xs text-gray-600/60">No events yet</p>
                ) : (
                  report.deviceSplit.map((d) => (
                    <div key={d.device} className="flex items-center gap-3">
                      <span className="flex-1 text-xs text-gray-400/80 capitalize">{d.device}</span>
                      <Bar pct={report.uniqueSessions ? Math.round((d.sessions / report.uniqueSessions) * 1000) / 10 : 0} />
                      <span className="w-10 text-right text-xs text-white tabular-nums">{d.sessions}</span>
                    </div>
                  ))
                )}
              </section>
            </div>

            <p className="text-center text-[11px] text-gray-600/50 pb-6">
              Events are logged client-side to a JSONL file — no database. Data appears as visitors flow through the funnel.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
