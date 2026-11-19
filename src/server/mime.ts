/** Address parsing and a small MIME writer for the raw copy of mail sent inside the team. */

export interface Address {
  address: string;
  name?: string;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** "a@x.com, Name <b@y.com>" as addresses; null when one is not an address. */
export function parseAddressList(input: string): Address[] | null {
  const parts = input
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Address[] = [];
  for (const part of parts) {
    const angle = /^(.*)<([^>]+)>$/.exec(part);
    const address = (angle ? angle[2]! : part).trim().toLowerCase();
    if (!EMAIL.test(address)) return null;
    const name = angle ? angle[1]!.trim().replace(/^"|"$/g, "") : undefined;
    out.push(name ? { address, name } : { address });
  }
  return out;
}

export function formatAddress(a: Address): string {
  return a.name ? `"${a.name.replace(/"/g, "")}" <${a.address}>` : a.address;
}

/** Message-IDs in a References or In-Reply-To header. */
export function messageIds(header: string | null | undefined): string[] {
  if (!header) return [];
  return header.match(/<[^<>\s]+>/g) ?? [];
}

export function replySubject(subject: string, prefix: "Re" | "Fwd"): string {
  const re = new RegExp(`^${prefix}:\\s`, "i");
  return re.test(subject) ? subject : `${prefix}: ${subject}`;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}

function base64Lines(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (btoa(binary).match(/.{1,76}/g) ?? []).join("\r\n");
}

export function buildRaw(m: {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  date: Date;
  attachments: { filename: string; contentType: string; content: Uint8Array }[];
}): string {
  const boundary = `b-${crypto.randomUUID()}`;
  const headers = [
    `From: ${formatAddress(m.from)}`,
    `To: ${m.to.map(formatAddress).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(formatAddress).join(", ")}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${m.date.toUTCString()}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(new TextEncoder().encode(m.text)),
    ].join("\r\n"),
    ...m.attachments.map((a) =>
      [
        `Content-Type: ${a.contentType}; name="${a.filename.replace(/"/g, "")}"`,
        `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`,
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(a.content),
      ].join("\r\n"),
    ),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n")}\r\n--${boundary}--\r\n`;
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
