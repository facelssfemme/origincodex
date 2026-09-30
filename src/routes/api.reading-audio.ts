import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/reading-audio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const [{ store }, { paymentConfig }, { audio }] = await Promise.all([
            import("../server/orders/store"),
            import("../server/orders/config"),
            import("../server/orders/http"),
          ]);
          return await audio(request, store(), paymentConfig().accessSecret);
        } catch {
          return new Response("Audio unavailable", {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        }
      },
    },
  },
});
