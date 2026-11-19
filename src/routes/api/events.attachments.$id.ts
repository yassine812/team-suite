import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eventAttachment } from "@/server/calendar";
import { objectResponse, requireMember } from "@/server/http";

// An event attachment, to people who can see the event's details.
export const Route = createFileRoute("/api/events/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await requireMember(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const att = /^[0-9a-f-]{36}$/.test(params.id) ? await eventAttachment(user.id, params.id) : null;
        const obj = att ? await env.files.get(att.r2Key) : null;
        if (!att || !obj) return new Response("Not found", { status: 404 });
        return objectResponse(obj, att.filename, att.contentType, true);
      },
    },
  },
});
