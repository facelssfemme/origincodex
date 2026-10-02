import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/email-delivery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const [{ deliveryReceipt }, { sql }] = await Promise.all([
            import("../server/delivery-receipt"),
            import("../db"),
          ]);
          return await deliveryReceipt(
            request,
            (q, p) => sql().query(q, p),
            process.env.SYRENA_EMAIL_WEBHOOK_SECRET || "",
          );
        } catch {
          return new Response("Delivery verification unavailable", {
            status: 503,
          });
        }
      },
    },
  },
});
