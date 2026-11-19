import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import * as mail from "@/server/mail";
import { sendInput, sendMail } from "@/server/mailSend";
import { aiInput, assist } from "@/server/ai";
import { quotaBytes, saveCopy } from "@/server/files";
import { memberMiddleware } from "./middleware";

async function mailboxOf(userId: string) {
  const box = await mail.getMailbox(userId);
  if (!box) throw new Error("Create your address first.");
  return box;
}

export const getMailHome = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => mail.listInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const box = await mail.getMailbox(context.user.id);
    if (!box) return { mailbox: null, domain: env.MAIL_DOMAIN ?? null, threads: [], labels: [], unread: 0 };
    const [threads, labels, unread] = await Promise.all([mail.listThreads(box.id, data), mail.listLabels(box.id), mail.unreadCount(box.id)]);
    return { mailbox: { address: box.address }, domain: env.MAIL_DOMAIN ?? null, threads, labels, unread };
  });

export const createMailbox = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => mail.localPartInput.parse(d))
  .handler(async ({ data, context }) => {
    const domain = env.MAIL_DOMAIN?.trim();
    if (!domain) return { error: "The mail domain isn't set for this app yet." };
    return mail.createMailbox(context.user.id, domain, data.localPart);
  });

export const getThread = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const box = await mail.getMailbox(context.user.id);
    if (!box || !z.string().uuid().safeParse(data.id).success) return null;
    const thread = await mail.getThread(box.id, data.id);
    if (thread && thread.messages.some((m) => !m.isRead)) await mail.threadAction(env.files, box.id, { threadId: data.id, action: "read" });
    return thread ? { ...thread, me: box.address } : null;
  });

export const threadAction = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => mail.threadActionInput.parse(d))
  .handler(async ({ data, context }) => mail.threadAction(env.files, (await mailboxOf(context.user.id)).id, data));

export const emptyTrash = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .handler(async ({ context }) => mail.emptyTrash(env.files, (await mailboxOf(context.user.id)).id));

export const setLabel = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => mail.labelInput.parse(d))
  .handler(async ({ data, context }) => mail.setLabel((await mailboxOf(context.user.id)).id, data));

export const send = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data, context }) => sendMail(env.files, env, context.user.id, data));

export const saveAttachment = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const box = await mailboxOf(context.user.id);
    const att = await mail.getAttachment(box.id, data.id);
    if (!att) return { error: "Attachment not found." };
    return saveCopy(env.files, quotaBytes(env.STORAGE_QUOTA_MB), context.user.id, att);
  });

export const aiAssist = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => aiInput.parse(d))
  .handler(async ({ data }) => assist(env, data));
