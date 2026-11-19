import PostalMime from "postal-mime";
import { mailboxByAddress, storeMessage } from "./mail";

/** Files a message Email Routing delivered; unknown recipients are refused. */
export async function receiveMail(
  bucket: R2Bucket,
  recipient: string,
  raw: Uint8Array,
): Promise<{ rejected: string } | { stored: boolean }> {
  const mailbox = await mailboxByAddress(recipient);
  if (!mailbox) return { rejected: "No such recipient" };
  const parsed = await PostalMime.parse(raw);
  const date = parsed.date && !Number.isNaN(Date.parse(parsed.date)) ? new Date(parsed.date).toISOString() : new Date().toISOString();
  const list = (items: typeof parsed.to) =>
    (items ?? []).flatMap((a) => ("group" in a && a.group ? a.group : [a])).filter((a) => a.address).map((a) => ({ address: a.address!.toLowerCase(), ...(a.name ? { name: a.name } : {}) }));
  const result = await storeMessage(
    bucket,
    mailbox.id,
    {
      messageId: parsed.messageId || `<${crypto.randomUUID()}@inbound>`,
      inReplyTo: parsed.inReplyTo ?? null,
      references: parsed.references ?? null,
      from: { address: (parsed.from?.address ?? "unknown@unknown").toLowerCase(), ...(parsed.from?.name ? { name: parsed.from.name } : {}) },
      to: list(parsed.to),
      cc: list(parsed.cc),
      subject: parsed.subject ?? "",
      text: parsed.text ?? "",
      html: parsed.html ?? null,
      date,
      attachments: parsed.attachments.map((a) => ({
        filename: a.filename ?? "attachment",
        contentType: a.mimeType,
        content: typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content),
      })),
    },
    raw,
    "inbox",
  );
  return { stored: !!result };
}
