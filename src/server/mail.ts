import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  mailAttachments,
  mailboxes,
  mailLabels,
  mailMessages,
  mailThreadLabels,
  mailThreads,
} from "@/db/schema";
import { messageIds, type Address } from "./mime";

/** Local parts no member may take: role addresses mail systems rely on. */
export const RESERVED_LOCAL_PARTS = new Set([
  "abuse", "admin", "administrator", "hostmaster", "mailer-daemon", "noreply",
  "no-reply", "postmaster", "root", "security", "webmaster", "info", "support",
]);

export const localPartInput = z
  .object({ localPart: z.string().trim().toLowerCase().max(64) })
  .strict();

/** Why a local part can't be used, or null when it can. */
export function localPartProblem(localPart: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(localPart))
    return "Use letters, numbers, dots, dashes or underscores.";
  if (RESERVED_LOCAL_PARTS.has(localPart)) return "That address is reserved.";
  return null;
}

export async function getMailbox(userId: string) {
  const [row] = await db.select().from(mailboxes).where(eq(mailboxes.userId, userId));
  return row ?? null;
}

export async function createMailbox(
  userId: string,
  domain: string,
  localPart: string,
): Promise<{ address: string } | { error: string }> {
  const problem = localPartProblem(localPart);
  if (problem) return { error: problem };
  if (await getMailbox(userId)) return { error: "You already have an address." };
  const address = `${localPart}@${domain.toLowerCase()}`;
  const [row] = await db
    .insert(mailboxes)
    .values({ id: crypto.randomUUID(), userId, address })
    .onConflictDoNothing()
    .returning();
  if (!row) return { error: "That address is taken." };
  return { address };
}

export async function mailboxByAddress(address: string) {
  const [row] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.address, address.trim().toLowerCase()));
  return row ?? null;
}

export interface IncomingMessage {
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  text: string;
  html: string | null;
  date: string;
  attachments: { filename: string; contentType: string; content: Uint8Array }[];
}

/** The thread a message joins in a mailbox: the one holding any message it refers to. */
export async function threadFor(mailboxId: string, refs: string[]): Promise<string | null> {
  if (!refs.length) return null;
  const [row] = await db
    .select({ threadId: mailMessages.threadId })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxId, mailboxId), inArray(mailMessages.messageId, refs)))
    .limit(1);
  return row?.threadId ?? null;
}

/** Stores one message in a mailbox: the raw source and attachments in R2, the rest in D1. */
export async function storeMessage(
  bucket: R2Bucket,
  mailboxId: string,
  m: IncomingMessage,
  raw: string | Uint8Array | null,
  folder: "inbox" | "sent",
): Promise<{ id: string; threadId: string } | null> {
  const [dupe] = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.mailboxId, mailboxId),
        eq(mailMessages.messageId, m.messageId),
        eq(mailMessages.folder, folder),
      ),
    );
  if (dupe) return null;
  const refs = [...messageIds(m.inReplyTo), ...messageIds(m.references)];
  let threadId = await threadFor(mailboxId, refs);
  const id = crypto.randomUUID();
  const rawKey = raw ? `mail/${mailboxId}/${id}.eml` : null;
  if (raw && rawKey) await bucket.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
  const attachmentRows = [];
  for (const a of m.attachments) {
    const attId = crypto.randomUUID();
    const key = `mail/${mailboxId}/${id}/${attId}`;
    await bucket.put(key, a.content, { httpMetadata: { contentType: a.contentType } });
    attachmentRows.push({
      id: attId,
      messageId: id,
      mailboxId,
      filename: a.filename || "attachment",
      contentType: a.contentType || "application/octet-stream",
      size: a.content.byteLength,
      r2Key: key,
    });
  }
  const statements = [];
  if (!threadId) {
    threadId = crypto.randomUUID();
    statements.push(
      db.insert(mailThreads).values({ id: threadId, mailboxId, subject: m.subject || "(no subject)", lastAt: m.date }),
    );
  } else {
    statements.push(
      db.update(mailThreads).set({ lastAt: sql`max(${mailThreads.lastAt}, ${m.date})` }).where(eq(mailThreads.id, threadId)),
    );
  }
  statements.push(
    db.insert(mailMessages).values({
      id,
      mailboxId,
      threadId,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      fromAddress: m.from.address.toLowerCase(),
      fromName: m.from.name ?? null,
      to: JSON.stringify(m.to),
      cc: JSON.stringify(m.cc),
      subject: m.subject || "(no subject)",
      text: m.text,
      html: m.html,
      date: m.date,
      folder,
      isRead: folder === "sent",
      rawKey,
    }),
  );
  if (attachmentRows.length) statements.push(db.insert(mailAttachments).values(attachmentRows));
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return { id, threadId };
}

export const folders = ["inbox", "sent", "starred", "archive", "trash"] as const;
export const listInput = z
  .object({
    folder: z.enum(folders).default("inbox"),
    label: z.string().max(100).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

export interface ThreadSummary {
  id: string;
  subject: string;
  lastAt: string;
  unread: boolean;
  starred: boolean;
  count: number;
  from: string;
  snippet: string;
}

export async function listThreads(mailboxId: string, input: z.infer<typeof listInput>): Promise<ThreadSummary[]> {
  const conds = [sql`m.mailbox_id = ${mailboxId}`];
  if (input.q) {
    const like = `%${input.q.replace(/[%_]/g, "")}%`;
    conds.push(sql`m.folder <> 'trash'`);
    conds.push(
      sql`(m.subject like ${like} or m.text like ${like} or m.from_address like ${like} or coalesce(m.from_name,'') like ${like})`,
    );
  } else if (input.label) {
    conds.push(sql`m.folder <> 'trash'`);
    conds.push(
      sql`t.id in (select tl.thread_id from mail_thread_labels tl join mail_labels l on l.id = tl.label_id where l.mailbox_id = ${mailboxId} and l.name = ${input.label})`,
    );
  } else if (input.folder === "starred") {
    conds.push(sql`m.is_starred = 1 and m.folder <> 'trash'`);
  } else {
    conds.push(sql`m.folder = ${input.folder}`);
  }
  const where = sql.join(conds, sql` and `);
  const rows = await db.all<{
    id: string; subject: string; last_at: string; unread: number; starred: number; count: number; from_name: string | null; from_address: string; text: string;
  }>(sql`
    select t.id, t.subject, t.last_at,
      (select count(*) from mail_messages x where x.thread_id = t.id and x.is_read = 0) as unread,
      (select count(*) from mail_messages x where x.thread_id = t.id and x.is_starred = 1) as starred,
      (select count(*) from mail_messages x where x.thread_id = t.id) as count,
      l.from_name, l.from_address, l.text
    from mail_threads t
    join mail_messages l on l.id = (select y.id from mail_messages y where y.thread_id = t.id order by y.date desc limit 1)
    where t.mailbox_id = ${mailboxId} and t.id in (select m.thread_id from mail_messages m where ${where})
    order by t.last_at desc limit 200`);
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    lastAt: r.last_at,
    unread: r.unread > 0,
    starred: r.starred > 0,
    count: r.count,
    from: r.from_name || r.from_address,
    snippet: r.text.replace(/\s+/g, " ").slice(0, 140),
  }));
}

export async function getThread(mailboxId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(mailThreads)
    .where(and(eq(mailThreads.id, threadId), eq(mailThreads.mailboxId, mailboxId)));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.threadId, threadId), eq(mailMessages.mailboxId, mailboxId)))
    .orderBy(mailMessages.date);
  const attachments = messages.length
    ? await db
        .select({ id: mailAttachments.id, messageId: mailAttachments.messageId, filename: mailAttachments.filename, contentType: mailAttachments.contentType, size: mailAttachments.size })
        .from(mailAttachments)
        .where(and(eq(mailAttachments.mailboxId, mailboxId), inArray(mailAttachments.messageId, messages.map((m) => m.id))))
    : [];
  const labels = await db
    .select({ id: mailLabels.id, name: mailLabels.name })
    .from(mailThreadLabels)
    .innerJoin(mailLabels, eq(mailLabels.id, mailThreadLabels.labelId))
    .where(and(eq(mailThreadLabels.threadId, threadId), eq(mailLabels.mailboxId, mailboxId)));
  return {
    id: thread.id,
    subject: thread.subject,
    labels,
    messages: messages.map((m) => ({
      id: m.id,
      messageId: m.messageId,
      references: m.references,
      from: { address: m.fromAddress, name: m.fromName ?? undefined } as Address,
      to: JSON.parse(m.to) as Address[],
      cc: JSON.parse(m.cc) as Address[],
      subject: m.subject,
      text: m.text,
      html: m.html,
      date: m.date,
      folder: m.folder,
      isRead: m.isRead,
      isStarred: m.isStarred,
      attachments: attachments.filter((a) => a.messageId === m.id),
    })),
  };
}

export const threadActionInput = z
  .object({
    threadId: z.string().uuid(),
    action: z.enum(["star", "unstar", "read", "unread", "archive", "inbox", "trash", "restore", "delete"]),
  })
  .strict();

export async function threadAction(
  bucket: R2Bucket,
  mailboxId: string,
  { threadId, action }: z.infer<typeof threadActionInput>,
): Promise<boolean> {
  const scope = and(eq(mailMessages.threadId, threadId), eq(mailMessages.mailboxId, mailboxId));
  const [exists] = await db.select({ id: mailThreads.id }).from(mailThreads).where(and(eq(mailThreads.id, threadId), eq(mailThreads.mailboxId, mailboxId)));
  if (!exists) return false;
  switch (action) {
    case "star": {
      const [last] = await db.select({ id: mailMessages.id }).from(mailMessages).where(scope).orderBy(desc(mailMessages.date)).limit(1);
      if (last) await db.update(mailMessages).set({ isStarred: true }).where(eq(mailMessages.id, last.id));
      break;
    }
    case "unstar":
      await db.update(mailMessages).set({ isStarred: false }).where(scope);
      break;
    case "read":
    case "unread":
      await db.update(mailMessages).set({ isRead: action === "read" }).where(scope);
      break;
    case "archive":
      await db.update(mailMessages).set({ folder: "archive" }).where(and(scope, eq(mailMessages.folder, "inbox")));
      break;
    case "inbox":
      await db.update(mailMessages).set({ folder: "inbox" }).where(and(scope, eq(mailMessages.folder, "archive")));
      break;
    case "trash":
      await db
        .update(mailMessages)
        .set({ previousFolder: sql`${mailMessages.folder}`, folder: "trash" })
        .where(and(scope, sql`${mailMessages.folder} <> 'trash'`));
      break;
    case "restore":
      await db
        .update(mailMessages)
        .set({ folder: sql`coalesce(${mailMessages.previousFolder}, 'inbox')`, previousFolder: null })
        .where(and(scope, eq(mailMessages.folder, "trash")));
      break;
    case "delete":
      await deleteThreads(bucket, mailboxId, [threadId]);
      break;
  }
  return true;
}

async function deleteThreads(bucket: R2Bucket, mailboxId: string, threadIds: string[]) {
  if (!threadIds.length) return;
  const msgs = await db
    .select({ id: mailMessages.id, rawKey: mailMessages.rawKey })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxId, mailboxId), inArray(mailMessages.threadId, threadIds)));
  const atts = msgs.length
    ? await db.select({ key: mailAttachments.r2Key }).from(mailAttachments).where(and(eq(mailAttachments.mailboxId, mailboxId), inArray(mailAttachments.messageId, msgs.map((m) => m.id))))
    : [];
  const keys = [...msgs.map((m) => m.rawKey).filter((k): k is string => !!k), ...atts.map((a) => a.key)];
  if (keys.length) await bucket.delete(keys);
  await db.batch([
    ...(msgs.length ? [db.delete(mailAttachments).where(and(eq(mailAttachments.mailboxId, mailboxId), inArray(mailAttachments.messageId, msgs.map((m) => m.id))))] : []),
    db.delete(mailMessages).where(and(eq(mailMessages.mailboxId, mailboxId), inArray(mailMessages.threadId, threadIds))),
    db.delete(mailThreadLabels).where(inArray(mailThreadLabels.threadId, threadIds)),
    db.delete(mailThreads).where(and(eq(mailThreads.mailboxId, mailboxId), inArray(mailThreads.id, threadIds))),
  ] as never);
}

/** Deletes every thread whose messages are all in the trash. */
export async function emptyTrash(bucket: R2Bucket, mailboxId: string): Promise<number> {
  const rows = await db.all<{ id: string }>(sql`
    select t.id from mail_threads t where t.mailbox_id = ${mailboxId}
      and exists (select 1 from mail_messages m where m.thread_id = t.id and m.folder = 'trash')
      and not exists (select 1 from mail_messages m where m.thread_id = t.id and m.folder <> 'trash')`);
  // Trashed messages in threads that still have other messages go on their own.
  const partial = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxId, mailboxId), eq(mailMessages.folder, "trash"), rows.length ? sql`${mailMessages.threadId} not in ${rows.map((r) => r.id)}` : sql`1=1`));
  if (partial.length) {
    await db.delete(mailAttachments).where(and(eq(mailAttachments.mailboxId, mailboxId), inArray(mailAttachments.messageId, partial.map((p) => p.id))));
    await db.delete(mailMessages).where(and(eq(mailMessages.mailboxId, mailboxId), inArray(mailMessages.id, partial.map((p) => p.id))));
  }
  await deleteThreads(bucket, mailboxId, rows.map((r) => r.id));
  return rows.length + partial.length;
}

export const labelInput = z
  .object({ threadId: z.string().uuid(), name: z.string().trim().min(1).max(40), remove: z.boolean().optional() })
  .strict();

export async function setLabel(mailboxId: string, { threadId, name, remove }: z.infer<typeof labelInput>) {
  const [thread] = await db.select({ id: mailThreads.id }).from(mailThreads).where(and(eq(mailThreads.id, threadId), eq(mailThreads.mailboxId, mailboxId)));
  if (!thread) return false;
  if (remove) {
    const [label] = await db.select().from(mailLabels).where(and(eq(mailLabels.mailboxId, mailboxId), eq(mailLabels.name, name)));
    if (label) await db.delete(mailThreadLabels).where(and(eq(mailThreadLabels.threadId, threadId), eq(mailThreadLabels.labelId, label.id)));
    return true;
  }
  await db.insert(mailLabels).values({ id: crypto.randomUUID(), mailboxId, name }).onConflictDoNothing();
  const [label] = await db.select().from(mailLabels).where(and(eq(mailLabels.mailboxId, mailboxId), eq(mailLabels.name, name)));
  await db.insert(mailThreadLabels).values({ threadId, labelId: label!.id }).onConflictDoNothing();
  return true;
}

export async function listLabels(mailboxId: string) {
  return db.select({ id: mailLabels.id, name: mailLabels.name }).from(mailLabels).where(eq(mailLabels.mailboxId, mailboxId)).orderBy(mailLabels.name);
}

export async function getAttachment(mailboxId: string, id: string) {
  const [row] = await db
    .select()
    .from(mailAttachments)
    .where(and(eq(mailAttachments.id, id), eq(mailAttachments.mailboxId, mailboxId)));
  return row ?? null;
}

export async function unreadCount(mailboxId: string): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`select count(distinct thread_id) as n from mail_messages where mailbox_id = ${mailboxId} and folder = 'inbox' and is_read = 0`);
  return row?.n ?? 0;
}
