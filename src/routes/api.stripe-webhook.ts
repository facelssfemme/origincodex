import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const [{ store }, { stripeGateway }, { webhook }] = await Promise.all(
            [
              import("../server/orders/store"),
              import("../server/orders/stripe"),
              import("../server/orders/http"),
            ],
          );
          return await webhook(request, store(), stripeGateway());
        } catch {
          return new Response("Webhook unavailable", { status: 503 });
        }
      },
    },
  },
});
