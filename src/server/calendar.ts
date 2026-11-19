import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { calendars, calendarShares, eventAttachments, eventGuests, events, users } from "@/db/schema";
import { fromBase64 } from "./mime";
import { createRoom } from "./meet";
import { emailsFor, findUsersByEmail } from "./users";

export const COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type ShareLevel = "freebusy" | "details" | "edit";
const RANK: Record<ShareLevel | "owner", number> = { freebusy: 1, details: 2, edit: 3, owner: 4 };

/** The member's calendars, making their first one on first use. */
export async function myCalendars(userId: string) {
  let own = await db.select().from(calendars).where(eq(calendars.ownerId, userId)).orderBy(calendars.createdAt);
  if (!own.length) {
    await db.insert(calendars).values({ id: crypto.randomUUID(), ownerId: userId, name: "My calendar", color: "chart-1", isPrimary: true });
    own = await db.select().from(calendars).where(eq(calendars.ownerId, userId));
  }
  const shared = await db
    .select({ id: calendars.id, name: calendars.name, color: calendars.color, ownerId: calendars.ownerId, level: calendarShares.level })
    .from(calendarShares)
    .innerJoin(calendars, eq(calendars.id, calendarShares.calendarId))
    .where(eq(calendarShares.userId, userId));
  const owners = await emailsFor(shared.map((s) => s.ownerId));
  return {
    own: own.map((c) => ({ id: c.id, name: c.name, color: c.color, isPrimary: c.isPrimary })),
    shared: shared.map((s) => ({ id: s.id, name: s.name, color: s.color, level: s.level, owner: owners.get(s.ownerId) ?? "" })),
  };
}

/** What a member may do with a calendar: its owner, a share level, or nothing. */
async function calendarAccess(userId: string, calendarId: string): Promise<ShareLevel | "owner" | null> {
  const [cal] = await db.select().from(calendars).where(eq(calendars.id, calendarId));
  if (!cal) return null;
  if (cal.ownerId === userId) return "owner";
  const [share] = await db.select().from(calendarShares).where(and(eq(calendarShares.calendarId, calendarId), eq(calendarShares.userId, userId)));
  return share?.level ?? null;
}

export const calendarInput = z.object({ name: z.string().trim().min(1).max(60), color: z.enum(COLORS) }).strict();

export async function createCalendar(userId: string, input: z.infer<typeof calendarInput>) {
  await db.insert(calendars).values({ id: crypto.randomUUID(), ownerId: userId, ...input });
}

export async function deleteCalendar(bucket: R2Bucket, userId: string, id: string) {
  const [cal] = await db.select().from(calendars).where(and(eq(calendars.id, id), eq(calendars.ownerId, userId)));
  if (!cal || cal.isPrimary) return false;
  const evs = await db.select({ id: events.id }).from(events).where(eq(events.calendarId, id));
  for (const e of evs) await removeEvent(bucket, e.id);
  await db.batch([db.delete(calendarShares).where(eq(calendarShares.calendarId, id)), db.delete(calendars).where(eq(calendars.id, id))]);
  return true;
}

export const shareCalendarInput = z
  .object({ calendarId: z.string().uuid(), email: z.string().trim().toLowerCase().email(), level: z.enum(["freebusy", "details", "edit"]).nullable() })
  .strict();

export async function shareCalendar(userId: string, input: z.infer<typeof shareCalendarInput>): Promise<{ error?: string }> {
  if ((await calendarAccess(userId, input.calendarId)) !== "owner") return { error: "Only the calendar's owner can share it." };
  const target = (await findUsersByEmail([input.email])).get(input.email);
  if (!target) return { error: "No member with that email has opened this app yet." };
  if (target === userId) return { error: "That's you." };
  if (input.level === null) {
    await db.delete(calendarShares).where(and(eq(calendarShares.calendarId, input.calendarId), eq(calendarShares.userId, target)));
  } else {
    await db
      .insert(calendarShares)
      .values({ calendarId: input.calendarId, userId: target, level: input.level })
      .onConflictDoUpdate({ target: [calendarShares.calendarId, calendarShares.userId], set: { level: input.level } });
  }
  return {};
}

export async function calendarShareList(userId: string, calendarId: string) {
  if ((await calendarAccess(userId, calendarId)) !== "owner") return [];
  const rows = await db.select({ userId: calendarShares.userId, level: calendarShares.level, email: users.email }).from(calendarShares).innerJoin(users, eq(users.id, calendarShares.userId)).where(eq(calendarShares.calendarId, calendarId));
  return rows.map((r) => ({ email: r.email, level: r.level }));
}

export const rangeInput = z.object({ from: z.string().datetime(), to: z.string().datetime() }).strict();

export interface CalendarEvent {
  id: string;
  calendarId: string;
  color: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busyOnly: boolean;
  canEdit: boolean;
  isGuest: boolean;
  myResponse: string | null;
}

/** Events the member can see in a range, each shown at their access level. */
export async function listEvents(userId: string, from: string, to: string): Promise<CalendarEvent[]> {
  const { own, shared } = await myCalendars(userId);
  const levels = new Map<string, ShareLevel | "owner">([
    ...own.map((c) => [c.id, "owner"] as const),
    ...shared.map((s) => [s.id, s.level] as const),
  ]);
  const colors = new Map([...own, ...shared].map((c) => [c.id, c.color]));
  const inRange = and(lt(events.start, to), gt(events.end, from));
  const calIds = [...levels.keys()];
  const onCalendars = calIds.length ? await db.select().from(events).where(and(inArray(events.calendarId, calIds), inRange)) : [];
  const invited = await db
    .select({ event: events, response: eventGuests.response })
    .from(eventGuests)
    .innerJoin(events, eq(events.id, eventGuests.eventId))
    .where(and(eq(eventGuests.userId, userId), inRange));
  const out = new Map<string, CalendarEvent>();
  for (const e of onCalendars) {
    const level = levels.get(e.calendarId)!;
    const busyOnly = level === "freebusy";
    out.set(e.id, {
      id: e.id,
      calendarId: e.calendarId,
      color: colors.get(e.calendarId) ?? "chart-1",
      title: busyOnly ? "Busy" : e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      busyOnly,
      canEdit: RANK[level] >= RANK.edit,
      isGuest: false,
      myResponse: null,
    });
  }
  for (const { event: e, response } of invited) {
    const existing = out.get(e.id);
    if (existing && !existing.busyOnly) {
      existing.isGuest = true;
      existing.myResponse = response;
      continue;
    }
    out.set(e.id, {
      id: e.id,
      calendarId: own.find((c) => c.isPrimary)?.id ?? e.calendarId,
      color: own.find((c) => c.isPrimary)?.color ?? "chart-1",
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      busyOnly: false,
      canEdit: existing?.canEdit ?? false,
      isGuest: true,
      myResponse: response,
    });
  }
  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** The member's access to an event: through its calendar or as a guest. */
async function eventAccess(userId: string, eventId: string) {
  const [e] = await db.select().from(events).where(eq(events.id, eventId));
  if (!e) return null;
  const level = await calendarAccess(userId, e.calendarId);
  const [guest] = await db.select().from(eventGuests).where(and(eq(eventGuests.eventId, eventId), eq(eventGuests.userId, userId)));
  if (!level && !guest) return null;
  const canSeeDetails = !!guest || (level !== null && level !== "freebusy");
  return { event: e, level, guest: guest ?? null, canSeeDetails, canEdit: level !== null && RANK[level] >= RANK.edit };
}

export async function getEvent(userId: string, eventId: string) {
  const access = await eventAccess(userId, eventId);
  if (!access || !access.canSeeDetails) return null;
  const e = access.event;
  const guests = await db.select({ email: eventGuests.email, response: eventGuests.response }).from(eventGuests).where(eq(eventGuests.eventId, eventId));
  const attachments = await db.select({ id: eventAttachments.id, filename: eventAttachments.filename, size: eventAttachments.size }).from(eventAttachments).where(eq(eventAttachments.eventId, eventId));
  const organizer = (await emailsFor([e.organizerId])).get(e.organizerId) ?? "";
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    timeZone: e.timeZone,
    location: e.location,
    description: e.description,
    meetCode: e.meetCode,
    organizer,
    guests,
    attachments,
    canEdit: access.canEdit,
    myResponse: access.guest?.response ?? null,
  };
}

export const eventInput = z
  .object({
    id: z.string().uuid().optional(),
    calendarId: z.string().uuid(),
    title: z.string().trim().min(1, "Add a title").max(200),
    start: z.string().datetime(),
    end: z.string().datetime(),
    allDay: z.boolean().default(false),
    timeZone: z.string().max(64).default("UTC"),
    location: z.string().max(300).default(""),
    description: z.string().max(10000).default(""),
    guests: z.array(z.string().trim().toLowerCase().email()).max(100).default([]),
    meeting: z.boolean().default(false),
    emailGuests: z.boolean().default(false),
    attachments: z.array(z.object({ filename: z.string().min(1).max(200), contentType: z.string().max(200), base64: z.string() })).max(10).default([]),
  })
  .strict()
  .refine((e) => e.end > e.start || (e.allDay && e.end >= e.start), "The end must be after the start");

export async function saveEvent(bucket: R2Bucket, userId: string, input: z.infer<typeof eventInput>): Promise<{ id: string; newGuests: string[] } | { error: string }> {
  const target = await calendarAccess(userId, input.calendarId);
  if (!target || RANK[target] < RANK.edit) return { error: "You can't add events to that calendar." };
  let id = input.id;
  let meetCode: string | null = null;
  let previousGuests: string[] = [];
  if (id) {
    const access = await eventAccess(userId, id);
    if (!access || !access.canEdit) return { error: "You can't change this event." };
    meetCode = access.event.meetCode;
    previousGuests = (await db.select({ email: eventGuests.email }).from(eventGuests).where(eq(eventGuests.eventId, id))).map((g) => g.email);
  }
  if (input.meeting && !meetCode) meetCode = (await createRoom(userId, input.title)).code;
  if (!input.meeting) meetCode = null;
  const fields = {
    calendarId: input.calendarId,
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    timeZone: input.timeZone,
    location: input.location,
    description: input.description,
    meetCode,
  };
  if (id) await db.update(events).set(fields).where(eq(events.id, id));
  else {
    id = crypto.randomUUID();
    await db.insert(events).values({ id, organizerId: userId, ...fields });
  }
  const guests = [...new Set(input.guests)];
  const ids = await findUsersByEmail(guests);
  const removed = previousGuests.filter((g) => !guests.includes(g));
  if (removed.length) await db.delete(eventGuests).where(and(eq(eventGuests.eventId, id), inArray(eventGuests.email, removed)));
  if (guests.length)
    await db
      .insert(eventGuests)
      .values(guests.map((email) => ({ eventId: id!, email, userId: ids.get(email) ?? null })))
      .onConflictDoNothing();
  for (const a of input.attachments) {
    const attId = crypto.randomUUID();
    const key = `events/${id}/${attId}`;
    const bytes = fromBase64(a.base64);
    await bucket.put(key, bytes, { httpMetadata: { contentType: a.contentType } });
    await db.insert(eventAttachments).values({ id: attId, eventId: id, filename: a.filename, contentType: a.contentType || "application/octet-stream", size: bytes.byteLength, r2Key: key });
  }
  return { id, newGuests: guests.filter((g) => !previousGuests.includes(g)) };
}

async function removeEvent(bucket: R2Bucket, eventId: string) {
  const atts = await db.select({ key: eventAttachments.r2Key }).from(eventAttachments).where(eq(eventAttachments.eventId, eventId));
  if (atts.length) await bucket.delete(atts.map((a) => a.key));
  await db.batch([
    db.delete(eventAttachments).where(eq(eventAttachments.eventId, eventId)),
    db.delete(eventGuests).where(eq(eventGuests.eventId, eventId)),
    db.delete(events).where(eq(events.id, eventId)),
  ]);
}

export async function deleteEvent(bucket: R2Bucket, userId: string, eventId: string) {
  const access = await eventAccess(userId, eventId);
  if (!access || !access.canEdit) return false;
  await removeEvent(bucket, eventId);
  return true;
}

export const respondInput = z.object({ eventId: z.string().uuid(), response: z.enum(["yes", "no", "maybe"]) }).strict();

export async function respond(userId: string, { eventId, response }: z.infer<typeof respondInput>) {
  const rows = await db.update(eventGuests).set({ response }).where(and(eq(eventGuests.eventId, eventId), eq(eventGuests.userId, userId))).returning();
  return rows.length > 0;
}

export async function eventAttachment(userId: string, id: string) {
  const [att] = await db.select().from(eventAttachments).where(eq(eventAttachments.id, id));
  if (!att) return null;
  const access = await eventAccess(userId, att.eventId);
  return access?.canSeeDetails ? att : null;
}

export const busyInput = z.object({ emails: z.array(z.string().trim().toLowerCase()).max(50), from: z.string().datetime(), to: z.string().datetime() }).strict();

/** Teammates' busy times in a range, as much as each one's sharing allows. */
export async function teammatesBusy(userId: string, input: z.infer<typeof busyInput>) {
  const ids = await findUsersByEmail(input.emails);
  const out: { email: string; start: string; end: string; title: string | null }[] = [];
  for (const [email, otherId] of ids) {
    if (otherId === userId) continue;
    const shared = await db
      .select({ id: calendars.id, level: calendarShares.level })
      .from(calendarShares)
      .innerJoin(calendars, eq(calendars.id, calendarShares.calendarId))
      .where(and(eq(calendarShares.userId, userId), eq(calendars.ownerId, otherId)));
    if (!shared.length) continue;
    const level = new Map(shared.map((s) => [s.id, s.level]));
    const rows = await db
      .select()
      .from(events)
      .where(and(inArray(events.calendarId, [...level.keys()]), lt(events.start, input.to), gt(events.end, input.from)));
    for (const e of rows) out.push({ email, start: e.start, end: e.end, title: level.get(e.calendarId) === "freebusy" ? null : e.title });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The owner's busy intervals across all their calendars, for booking pages. */
export async function ownerBusy(ownerId: string, from: string, to: string) {
  const cals = await db.select({ id: calendars.id }).from(calendars).where(eq(calendars.ownerId, ownerId));
  const onCals = cals.length
    ? await db.select({ start: events.start, end: events.end }).from(events).where(and(inArray(events.calendarId, cals.map((c) => c.id)), lt(events.start, to), gt(events.end, from)))
    : [];
  const asGuest = await db
    .select({ start: events.start, end: events.end })
    .from(eventGuests)
    .innerJoin(events, eq(events.id, eventGuests.eventId))
    .where(and(eq(eventGuests.userId, ownerId), or(eq(eventGuests.response, "yes"), eq(eventGuests.response, "maybe"), eq(eventGuests.response, "pending")), lt(events.start, to), gt(events.end, from)));
  return [...onCals, ...asGuest];
}

export const hoursInput = z
  .object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/), days: z.array(z.number().int().min(0).max(6)).max(7) })
  .strict()
  .refine((h) => h.end > h.start, "The end must be after the start");

export async function setWorkingHours(userId: string, h: z.infer<typeof hoursInput>) {
  await db.update(users).set({ workStart: h.start, workEnd: h.end, workDays: [...new Set(h.days)].sort().join(",") }).where(eq(users.id, userId));
}

export async function workingHours(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return { start: u?.workStart ?? "09:00", end: u?.workEnd ?? "17:00", days: (u?.workDays ?? "").split(",").filter(Boolean).map(Number) };
}
