import { createFileRoute } from "@tanstack/react-router";
import { freeSlots } from "@/server/booking";

// Public: a booking page's free slots on one day. Times only, never the owner's events.
export const Route = createFileRoute("/b/$slug/slots")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { slug: string } }) => {
        const date = new URL(request.url).searchParams.get("date") ?? "";
        const slots = await freeSlots(params.slug, date);
        if (!slots) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json({ slots }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
