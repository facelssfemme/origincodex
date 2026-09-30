import { createServerFn } from "@tanstack/react-start";
export const getAnalytics = createServerFn({ method: "POST" })
  .validator(
    (data: {
      from: string;
      to: string;
      environment: "test" | "live";
      secret: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { timingSafeEqual } = await import("node:crypto");
    const expected = process.env.SYRENA_REPORT_SECRET || "";
    if (
      expected.length < 32 ||
      typeof data?.secret !== "string" ||
      Buffer.byteLength(data.secret) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(data.secret), Buffer.from(expected))
    )
      throw Error("Report unavailable");
    try {
      const [{ report }, { sql }] = await Promise.all([
        import("./funnel"),
        import("../db"),
      ]);
      return await report(
        (q, p) => sql().query(q, p),
        data.from,
        data.to,
        data.environment,
      );
    } catch {
      throw Error(
        "Report unavailable: check configuration, migration, and dates",
      );
    }
  });
