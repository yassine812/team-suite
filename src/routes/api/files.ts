import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { addFile, quotaBytes } from "@/server/files";
import { requireMember } from "@/server/http";

// Uploads a file into My files or a folder the member can write to.
export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await requireMember(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const form = await request.formData();
        const file = form.get("file");
        const parent = form.get("parentId");
        if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
        const parentId = typeof parent === "string" && parent ? parent : null;
        if (parentId && !/^[0-9a-f-]{36}$/.test(parentId)) return Response.json({ error: "Folder not found." }, { status: 404 });
        const result = await addFile(env.files, quotaBytes(env.STORAGE_QUOTA_MB), user.id, parentId, {
          name: file.name,
          type: file.type,
          body: await file.arrayBuffer(),
          size: file.size,
        });
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json(result, { status: 201 });
      },
    },
  },
});
