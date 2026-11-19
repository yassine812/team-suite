import { eq } from "drizzle-orm";
import { env, waitUntil } from "cloudflare:workers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cancelByToken } from "./booking";
import { notifyBooking } from "./bookingMail";

/** Cancels the booking a token belongs to and tells both sides. */
export async function cancelBookingResponse(token: string): Promise<Response> {
  const b = await cancelByToken(token);
  if (!b) return Response.json({ error: "Not found" }, { status: 404 });
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, b.ownerId));
  waitUntil(notifyBooking(env, "cancelled", { title: "Your booking", start: b.start, end: b.end, name: b.name, email: b.email, ownerEmail: owner?.email ?? "" }));
  return Response.json({ ok: true });
}
