import { createServerFn } from "@tanstack/react-start";
import { isAdmin } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { quotaBytes, teamUsage } from "@/server/files";
import { memberMiddleware } from "./middleware";

/** Every member's address and storage use; organization admins only. */
export const getTeam = createServerFn()
  .middleware([memberMiddleware])
  .handler(async ({ context }) => {
    if (!isAdmin(context.user)) return { allowed: false as const };
    return { allowed: true as const, quota: quotaBytes(env.STORAGE_QUOTA_MB), members: await teamUsage() };
  });
