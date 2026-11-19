import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { readable } from "@/server/files";
import { objectResponse, requireMember } from "@/server/http";

// A file's contents, for preview or (?download=1) download, to anyone it is shared with.
export const Route = createFileRoute("/api/files/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await requireMember(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        if (!/^[0-9a-f-]{36}$/.test(params.id)) return new Response("Not found", { status: 404 });
        const node = await readable(user.id, params.id);
        if (!node?.r2Key) return new Response("Not found", { status: 404 });
        const obj = await env.files.get(node.r2Key);
        if (!obj) return new Response("File content is missing", { status: 404 });
        return objectResponse(obj, node.name, node.contentType ?? "application/octet-stream", new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
