import { and, eq, inArray } from "drizzle-orm";
import { GatewayRefusalError, sendEmail } from "@every-app/sdk/server";
import { z } from "zod";
import { db } from "@/db";
import { mailAttachments, mailboxes, mailMessages } from "@/db/schema";
import { getMailbox, storeMessage } from "./mail";
import { buildRaw, fromBase64, messageIds, parseAddressList, toBase64, type Address } from "./mime";

export const sendInput = z
  .object({
    to: z.string().max(4000),
    cc: z.string().max(4000).default(""),
    subject: z.string().max(300),
    text: z.string().max(200_000),
    replyTo: z.string().uuid().optional(),
    // Attachments of a message being forwarded.
    keepAttachments: z.array(z.string().uuid()).max(32).default([]),
    attachments: z
      .array(z.object({ filename: z.string().min(1).max(200), contentType: z.string().max(200), base64: z.string() }))
      .max(32)
      .default([]),
  })
  .strict();

const REFUSALS: Record<string, string> = {
  integration_not_configured: "Sending outside the team isn't set up on this Gateway yet.",
  email_sender_not_allowed: "This Gateway doesn't allow sending from your address yet.",
  email_sender_not_verified: "Your mail domain isn't verified for sending yet.",
  email_budget_exhausted: "Today's sending limit is reached. Try again tomorrow.",
};

export async function sendMail(
  bucket: R2Bucket,
  env: Cloudflare.Env,
  userId: string,
  input: z.infer<typeof sendInput>,
): Promise<{ threadId: string } | { error: string }> {
  const mailbox = await getMailbox(userId);
  if (!mailbox) return { error: "Create your address first." };
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  if (!to || !cc) return { error: "Check the recipients: one of them isn't an email address." };
  if (!to.length) return { error: "Add at least one recipient." };
  const domain = mailbox.address.split("@")[1]!;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (input.replyTo) {
    const [parent] = await db
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.id, input.replyTo), eq(mailMessages.mailboxId, mailbox.id)));
    if (!parent) return { error: "That message is gone." };
    inReplyTo = parent.messageId;
    references = [...messageIds(parent.references), parent.messageId].slice(-20).join(" ");
  }
  const attachments = input.attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType || "application/octet-stream",
    content: fromBase64(a.base64),
  }));
  if (input.keepAttachments.length) {
    const kept = await db
      .select()
      .from(mailAttachments)
      .where(and(eq(mailAttachments.mailboxId, mailbox.id), inArray(mailAttachments.id, input.keepAttachments)));
    for (const k of kept) {
      const obj = await bucket.get(k.r2Key);
      if (obj) attachments.push({ filename: k.filename, contentType: k.contentType, content: new Uint8Array(await obj.arrayBuffer()) });
    }
  }
  const everyone = [...to, ...cc];
  const local = await db
    .select()
    .from(mailboxes)
    .where(inArray(mailboxes.address, everyone.map((a) => a.address)));
  const localSet = new Set(local.map((m) => m.address));
  const external = everyone.filter((a) => !localSet.has(a.address));
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const from: Address = { address: mailbox.address };
  const subject = input.subject.trim() || "(no subject)";
  if (external.length) {
    try {
      await sendEmail({
        env,
        message: {
          to: to.filter((a) => !localSet.has(a.address)).map((a) => a.address),
          cc: cc.filter((a) => !localSet.has(a.address)).map((a) => a.address),
          subject,
          text: input.text,
          from: { address: mailbox.address, name: mailbox.address.split("@")[0]! },
          headers: {
            "Message-ID": messageId,
            ...(inReplyTo ? { "In-Reply-To": inReplyTo } : {}),
            ...(references ? { References: references } : {}),
          },
          attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: toBase64(a.content), disposition: "attachment" as const })),
        } as Parameters<typeof sendEmail>[0]["message"],
      });
    } catch (error) {
      if (error instanceof GatewayRefusalError)
        return { error: REFUSALS[error.code] ?? "The message couldn't be sent." };
      throw error;
    }
  }
  const date = new Date();
  const message = { messageId, inReplyTo, references, from, to, cc, subject, text: input.text, html: null, date: date.toISOString(), attachments };
  const raw = buildRaw({ ...message, date });
  const sent = await storeMessage(bucket, mailbox.id, message, raw, "sent");
  for (const box of local) await storeMessage(bucket, box.id, message, raw, "inbox");
  return { threadId: sent?.threadId ?? "" };
}
