import { sendEmail } from "@every-app/sdk/server";

/** Confirmation or cancellation mail to both sides; skipped when sending isn't set up. */
export async function notifyBooking(
  env: Cloudflare.Env,
  kind: "booked" | "cancelled",
  b: { title: string; start: string; end: string; name: string; email: string; ownerEmail: string; cancelUrl?: string },
) {
  const when = `${new Date(b.start).toUTCString()} (${Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000)} min)`;
  const target = { background: true, organizationId: env.EVERY_APP_ORG_ID } as never;
  const messages =
    kind === "booked"
      ? [
          { to: b.email, subject: `Booked: ${b.title}`, text: `You're booked for ${b.title} on ${when}.\n\nTo cancel: ${b.cancelUrl}` },
          { to: b.ownerEmail, subject: `New booking: ${b.title}`, text: `${b.name} <${b.email}> booked ${b.title} on ${when}.` },
        ]
      : [
          { to: b.email, subject: `Cancelled: ${b.title}`, text: `Your booking for ${b.title} on ${when} is cancelled.` },
          { to: b.ownerEmail, subject: `Cancelled: ${b.title}`, text: `${b.name} cancelled ${b.title} on ${when}.` },
        ];
  for (const message of messages) {
    if (!message.to) continue;
    try {
      await sendEmail({ env, for: target, message });
    } catch (error) {
      console.warn("Booking mail not sent:", (error as Error).message);
    }
  }
}
