import { createFileRoute } from "@tanstack/react-router";
import { env, waitUntil } from "cloudflare:workers";
import { book, bookInput } from "@/server/booking";
import { notifyBooking } from "@/server/bookingMail";

// Public: books one free slot. A slot taken in the meantime answers 409.
export const Route = createFileRoute("/b/$slug/book")({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { slug: string } }) => {
        const parsed = bookInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Add your name and a valid email." }, { status: 400 });
        const result = await book(params.slug, parsed.data);
        if (result.status === 404) return Response.json({ error: "Not found" }, { status: 404 });
        if (result.status === 409) return Response.json({ error: "That time was just taken. Pick another." }, { status: 409 });
        const cancelUrl = new URL(`/b/cancel/${result.token}`, request.url).toString();
        waitUntil(notifyBooking(env, "booked", { ...result, name: parsed.data.name, email: parsed.data.email, cancelUrl }));
        return Response.json({ start: result.start, end: result.end, cancelUrl }, { status: 201 });
      },
    },
  },
});
