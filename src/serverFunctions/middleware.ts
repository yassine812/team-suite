import { createMiddleware } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { touchUser } from "@/server/users";

/** The signed-in member, recorded in the app on first sight. */
export const memberMiddleware = createMiddleware({ type: "function" })
  .middleware([ensureUserMiddleware])
  .server(async ({ next, context }) => {
    await touchUser(context.user);
    return next();
  });
