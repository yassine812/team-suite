import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import * as files from "@/server/files";
import { eventAttachment } from "@/server/calendar";
import { memberMiddleware } from "./middleware";

export const getFiles = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.listInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const [list, used] = await Promise.all([files.listFiles(context.user.id, data), files.storageUsed(context.user.id)]);
    return { list, used, quota: files.quotaBytes(env.STORAGE_QUOTA_MB) };
  });

export const createFolder = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.folderInput.parse(d))
  .handler(async ({ data, context }) => files.createFolder(context.user.id, data));

export const renameNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.renameInput.parse(d))
  .handler(async ({ data, context }) => files.rename(context.user.id, data));

export const moveNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.moveInput.parse(d))
  .handler(async ({ data, context }) => files.move(context.user.id, data));

export const getMoveTargets = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.idInput.parse(d))
  .handler(async ({ data, context }) => files.moveTargets(context.user.id, data.id));

export const starNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.starInput.parse(d))
  .handler(async ({ data, context }) => files.star(context.user.id, data));

export const trashNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), trashed: z.boolean() }).strict().parse(d))
  .handler(async ({ data, context }) => files.setTrashed(context.user.id, data.id, data.trashed));

export const deleteNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.idInput.parse(d))
  .handler(async ({ data, context }) => files.deleteForever(env.files, context.user.id, data.id));

export const shareNode = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.shareInput.parse(d))
  .handler(async ({ data, context }) => files.share(context.user.id, data));

export const getShares = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.idInput.parse(d))
  .handler(async ({ data, context }) => files.shareList(context.user.id, data.id));

export const saveEventAttachment = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => files.idInput.parse(d))
  .handler(async ({ data, context }) => {
    const att = await eventAttachment(context.user.id, data.id);
    if (!att) return { error: "Attachment not found." };
    return files.saveCopy(env.files, files.quotaBytes(env.STORAGE_QUOTA_MB), context.user.id, att);
  });
