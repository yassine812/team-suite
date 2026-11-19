import { env } from "cloudflare:workers";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookingPages, bookings, calendars, eventGuests, events, users } from "@/db/schema";
import { ownerBusy } from "./calendar";
import { computeSlots, isValidTimeZone, type Window } from "./slots";

const windowSchema = z.object({ day: z.number().int().min(0).max(6), start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/) }).refine((w) => w.end > w.start, "A window must end after it starts");

export const pageInput = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1, "Add a title").max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "Use lowercase letters, numbers and dashes"),
    duration: z.number().int().min(5).max(480),
    buffer: z.number().int().min(0).max(240),
    minNotice: z.number().int().min(0).max(43200),
    horizonDays: z.number().int().min(1).max(365),
    calendarId: z.string().uuid(),
    timeZone: z.string().refine(isValidTimeZone, "Unknown time zone"),
    availability: z.array(windowSchema).min(1, "Choose at least one day").max(28),
  })
  .strict();

const RESERVED_SLUGS = new Set(["cancel"]);

export async function savePage(userId: string, input: z.infer<typeof pageInput>): Promise<{ error?: string }> {
  if (RESERVED_SLUGS.has(input.slug)) return { error: "That link is taken." };
  const [cal] = await db.select().from(calendars).where(and(eq(calendars.id, input.calendarId), eq(calendars.ownerId, userId)));
  if (!cal) return { error: "Pick one of your own calendars." };
  const values = { ...input, availability: JSON.stringify(input.availability) };
  delete (values as { id?: string }).id;
  try {
    if (input.id) {
      const rows = await db.update(bookingPages).set(values).where(and(eq(bookingPages.id, input.id), eq(bookingPages.ownerId, userId))).returning();
      if (!rows.length) return { error: "That page is gone." };
    } else {
      await db.insert(bookingPages).values({ id: crypto.randomUUID(), ownerId: userId, ...values });
    }
  } catch (error) {
    if (String(error).includes("UNIQUE")) return { error: "That link is taken." };
    throw error;
  }
  return {};
}

export async function listPages(userId: string) {
  const pages = await db.select().from(bookingPages).where(eq(bookingPages.ownerId, userId)).orderBy(bookingPages.createdAt);
  const upcoming = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.ownerId, userId), gte(bookings.end, new Date(Date.now() - 86400000).toISOString())))
    .orderBy(bookings.start);
  return pages.map((p) => ({
    ...p,
    availability: JSON.parse(p.availability) as Window[],
    bookings: upcoming.filter((b) => b.pageId === p.id).map((b) => ({ id: b.id, name: b.name, email: b.email, note: b.note, start: b.start, end: b.end, status: b.status })),
  }));
}

export async function setPaused(userId: string, id: string, paused: boolean) {
  await db.update(bookingPages).set({ paused }).where(and(eq(bookingPages.id, id), eq(bookingPages.ownerId, userId)));
}

export async function deletePage(userId: string, id: string) {
  await db.delete(bookingPages).where(and(eq(bookingPages.id, id), eq(bookingPages.ownerId, userId)));
}

/** What a visitor may see of a page: never the owner's events. */
export async function publicPage(slug: string) {
  const [p] = await db.select().from(bookingPages).where(eq(bookingPages.slug, slug));
  if (!p) return null;
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.ownerId));
  return { title: p.title, slug: p.slug, duration: p.duration, timeZone: p.timeZone, paused: p.paused, horizonDays: p.horizonDays, host: owner?.email ?? "" };
}

async function pageBySlug(slug: string) {
  const [p] = await db.select().from(bookingPages).where(eq(bookingPages.slug, slug));
  return p ?? null;
}

export async function freeSlots(slug: string, date: string, now = new Date()): Promise<string[] | null> {
  const p = await pageBySlug(slug);
  if (!p) return null;
  if (p.paused || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 2 * 86400000).toISOString();
  const to = new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 86400000).toISOString();
  const busy = await ownerBusy(p.ownerId, from, to);
  return computeSlots({ date, timeZone: p.timeZone, windows: JSON.parse(p.availability), duration: p.duration, buffer: p.buffer, minNotice: p.minNotice, horizonDays: p.horizonDays, busy, now });
}

export const bookInput = z
  .object({ start: z.string().datetime(), name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email(), note: z.string().max(2000).default("") })
  .strict();

export async function book(slug: string, input: z.infer<typeof bookInput>) {
  const p = await pageBySlug(slug);
  if (!p) return { status: 404 as const };
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: p.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(input.start));
  const slots = (await freeSlots(slug, date)) ?? [];
  const start = new Date(input.start).toISOString();
  if (!slots.includes(start)) return { status: 409 as const };
  const end = new Date(Date.parse(start) + p.duration * 60000).toISOString();
  const id = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const bufferMs = p.buffer * 60000;
  const lo = new Date(Date.parse(start) - bufferMs).toISOString();
  const hi = new Date(Date.parse(end) + bufferMs).toISOString();
  // One batch is one transaction: the insert only happens while no active booking overlaps.
  const d1 = env.DB;
  await d1.batch([
    d1
      .prepare(
        `insert into bookings (id, page_id, owner_id, event_id, name, email, note, start_at, end_at, cancel_token, status)
         select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active'
         where not exists (select 1 from bookings where owner_id = ?3 and status = 'active' and start_at < ?11 and end_at > ?12)`,
      )
      .bind(id, p.id, p.ownerId, eventId, input.name, input.email, input.note, start, end, token, hi, lo),
    d1
      .prepare(
        `insert into events (id, calendar_id, organizer_id, title, start_at, end_at, all_day, time_zone, location, description)
         select ?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, '', ?8 where exists (select 1 from bookings where id = ?9)`,
      )
      .bind(eventId, p.calendarId, p.ownerId, `${p.title}: ${input.name}`, start, end, p.timeZone, input.note, id),
    d1
      .prepare(`insert into event_guests (event_id, email, user_id, response) select ?1, ?2, null, 'yes' where exists (select 1 from bookings where id = ?3)`)
      .bind(eventId, input.email, id),
  ]);
  const [made] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!made) return { status: 409 as const };
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.ownerId));
  return { status: 201 as const, token, start, end, title: p.title, ownerEmail: owner?.email ?? "" };
}

export async function bookingByToken(token: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.cancelToken, token));
  if (!b) return null;
  const [p] = await db.select({ title: bookingPages.title }).from(bookingPages).where(eq(bookingPages.id, b.pageId));
  return { title: p?.title ?? "Booking", start: b.start, end: b.end, name: b.name, status: b.status, email: b.email, ownerId: b.ownerId };
}

export async function cancelByToken(token: string) {
  const [b] = await db.select().from(bookings).where(and(eq(bookings.cancelToken, token), eq(bookings.status, "active")));
  if (!b) return null;
  await db.batch([
    db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.id)),
    db.delete(eventGuests).where(eq(eventGuests.eventId, b.eventId)),
    db.delete(events).where(eq(events.id, b.eventId)),
  ]);
  return b;
}

export async function recentBookings(userId: string) {
  return db.select().from(bookings).where(eq(bookings.ownerId, userId)).orderBy(desc(bookings.start)).limit(100);
}
