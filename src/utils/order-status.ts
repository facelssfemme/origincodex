import { createServerFn } from "@tanstack/react-start";
export const getReadingStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    try {
      const [{ store }, { readingStatus }, { paymentConfig }] =
        await Promise.all([
          import("../server/orders/store"),
          import("../server/orders/access"),
          import("../server/orders/config"),
        ]);
      return await readingStatus(store(), data, paymentConfig().accessSecret);
    } catch {
      throw Error(
        "Order unavailable. Use the private link in your reading email.",
      );
    }
  });
