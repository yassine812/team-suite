import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAttachment, getMailbox } from "@/server/mail";
import { objectResponse, requireMember } from "@/server/http";

// A mail attachment, only from the member's own mailbox.
export const Route = createFileRoute("/api/mail/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await requireMember(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const box = await getMailbox(user.id);
        const att = box && /^[0-9a-f-]{36}$/.test(params.id) ? await getAttachment(box.id, params.id) : null;
        const obj = att ? await env.files.get(att.r2Key) : null;
        if (!att || !obj) return new Response("Not found", { status: 404 });
        return objectResponse(obj, att.filename, att.contentType, true);
      },
    },
  },
});
