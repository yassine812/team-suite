import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import * as meet from "@/server/meet";
import { memberMiddleware } from "./middleware";

export const getRooms = createServerFn()
  .middleware([memberMiddleware])
  .handler(async ({ context }) => meet.listMyRooms(context.user.id));

export const createRoom = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => meet.createRoomInput.parse(d))
  .handler(async ({ data, context }) => {
    const room = await meet.createRoom(context.user.id, data.title);
    return { code: room.code };
  });

export const getRoom = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ code: z.string().max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const room = await meet.roomForMember(data.code);
    if (!room) return null;
    return {
      title: room.title,
      ended: !!room.endedAt,
      isCreator: room.creatorId === context.user.id,
      me: context.user.email,
      link: new URL(`/meet/${room.code}`, getRequest().url).toString(),
      iceServers: meet.iceServers(env.ICE_SERVERS),
    };
  });
