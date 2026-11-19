import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes, users } from "@/db/schema";

export interface Member {
  id: string;
  email: string;
}

/** Records the member on first sight and keeps their email current. */
export async function touchUser(user: Member): Promise<void> {
  await db
    .insert(users)
    .values({ id: user.id, email: user.email.toLowerCase() })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: user.email.toLowerCase() },
      setWhere: sql`${users.email} <> ${user.email.toLowerCase()}`,
    });
}

/** Members by the email they sign in with or their team mail address. */
export async function findUsersByEmail(
  emails: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
  const found = new Map<string, string>();
  if (!wanted.length) return found;
  const byLogin = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, wanted));
  for (const row of byLogin) found.set(row.email, row.id);
  const byMailbox = await db
    .select({ id: mailboxes.userId, address: mailboxes.address })
    .from(mailboxes)
    .where(inArray(mailboxes.address, wanted));
  for (const row of byMailbox) found.set(row.address, row.id);
  return found;
}

export async function findUserByEmail(email: string): Promise<string | null> {
  return (await findUsersByEmail([email])).get(email.trim().toLowerCase()) ?? null;
}

export async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(or(inArray(users.id, [...new Set(ids)])));
  for (const r of rows) map.set(r.id, r.email);
  return map;
}

export async function getUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}
