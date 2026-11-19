import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { rooms } from "@/db/schema";

/** An unguessable room code: three groups of lowercase letters and digits, about 80 bits. */
export function newRoomCode(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5, 10).join("")}-${chars.slice(10, 16).join("")}`;
}

export const createRoomInput = z.object({ title: z.string().trim().max(120).default("") }).strict();

export async function createRoom(userId: string, title: string) {
  const code = newRoomCode();
  const [room] = await db
    .insert(rooms)
    .values({ id: crypto.randomUUID(), code, creatorId: userId, title: title || "Meeting" })
    .returning();
  return room!;
}

/** Any member with the code can open the room; the code is the invitation. */
export async function roomForMember(code: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code));
  return room ?? null;
}

export async function listMyRooms(userId: string) {
  return db
    .select()
    .from(rooms)
    .where(and(eq(rooms.creatorId, userId), isNull(rooms.endedAt)))
    .orderBy(desc(rooms.createdAt))
    .limit(50);
}

export async function endRoom(code: string) {
  await db.update(rooms).set({ endedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` }).where(eq(rooms.code, code));
}

/** ICE servers for calls: the relay setting when there is one, else none (direct connections). */
export function iceServers(value: string | undefined): RTCIceServer[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
