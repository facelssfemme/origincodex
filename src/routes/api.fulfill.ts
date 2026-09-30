import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/fulfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const [
            { store },
            { paymentConfig, required },
            { providers },
            { worker },
          ] = await Promise.all([
            import("../server/orders/store"),
            import("../server/orders/config"),
            import("../server/orders/providers"),
            import("../server/orders/http"),
          ]);
          return await worker(request, store(), providers, {
            ...paymentConfig(),
            workerSecret: required("SYRENA_WORKER_SECRET"),
          });
        } catch {
          return new Response("Worker unavailable", { status: 503 });
        }
      },
    },
  },
});
