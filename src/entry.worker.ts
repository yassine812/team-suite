import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp, getEveryAppUser } from "@every-app/sdk/server";
import { receiveMail } from "@/server/inbound";
import { roomForMember } from "@/server/meet";

export { MeetingRoom } from "@/server/MeetingRoom";

const ROOM_SOCKET = /^\/meet\/([a-z0-9-]{10,64})\/socket$/;

// everyApp() verifies the identity the Gateway sent before any request reaches
// the app (a request from anywhere else is a 401).
const app = everyApp<Env>(async (request, env) => {
  const socket = ROOM_SOCKET.exec(new URL(request.url).pathname);
  if (socket && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const user = await getEveryAppUser(request, env);
    if (!user) return new Response("Unauthorized", { status: 401 });
    const room = await roomForMember(socket[1]!);
    if (!room) return new Response("Not found", { status: 404 });
    const url = new URL(request.url);
    url.searchParams.set("uid", user.id);
    url.searchParams.set("email", user.email);
    url.searchParams.set("creator", room.creatorId === user.id ? "1" : "0");
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room.code));
    return stub.fetch(new Request(url, request));
  }
  return tanstackEntry.fetch(request);
});

export default {
  ...app,
  async email(message: ForwardableEmailMessage, env: Env) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const result = await receiveMail(env.files, message.to, raw);
    if ("rejected" in result) message.setReject(result.rejected);
  },
};
