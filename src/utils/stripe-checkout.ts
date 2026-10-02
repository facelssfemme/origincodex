import { createServerFn } from "@tanstack/react-start";
export const createCheckoutSession = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    try {
      const [{ store }, { stripeGateway }, { checkout }] = await Promise.all([
        import("../server/orders/store"),
        import("../server/orders/stripe"),
        import("../server/orders/checkout"),
      ]);
      const gateway = stripeGateway();
      return await checkout(store(), gateway, data, gateway.config);
    } catch {
      throw Error(
        "Checkout is unavailable. Your quiz is saved; please try again later.",
      );
    }
  });
