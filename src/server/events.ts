import { createServerFn } from "@tanstack/react-start";
export interface TrackedEvent {
  event_id: string;
  name: string;
  timestamp: string;
  session_id: string;
  device_type: string;
  traffic_source: string;
  page: string;
  props: Record<string, unknown>;
}
export const trackEvents = createServerFn({ method: "POST" })
  .validator((data: { events: TrackedEvent[] }) => data)
  .handler(async ({ data }) => {
    try {
      const [{ ingest }, { sql }] = await Promise.all([
        import("./funnel"),
        import("../db"),
      ]);
      const written = await ingest(
        (q, p) => sql().query(q, p),
        data?.events,
        process.env.SYRENA_ANALYTICS_MODE || "",
      );
      return { ok: true, written };
    } catch {
      return { ok: false, written: 0 };
    }
  });
