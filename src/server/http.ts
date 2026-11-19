import { getEveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { touchUser } from "./users";

/** The member behind a server route; the Gateway already refused everyone else. */
export async function requireMember(request: Request) {
  const user = await getEveryAppUser(request, env);
  if (user) await touchUser(user);
  return user;
}

export function objectResponse(obj: R2ObjectBody, name: string, contentType: string, download: boolean) {
  const safe = name.replace(/["\\\r\n]/g, "_");
  return new Response(obj.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      // Uploaded HTML or SVG never runs as the app; PDFs keep the browser's viewer.
      "content-security-policy": contentType === "application/pdf" ? "default-src 'none'; object-src 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
      "cache-control": "private, no-store",
    },
  });
}
