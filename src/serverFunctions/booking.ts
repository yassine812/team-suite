import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as booking from "@/server/booking";
import { myCalendars } from "@/server/calendar";
import { memberMiddleware } from "./middleware";

export const getBookingPages = createServerFn()
  .middleware([memberMiddleware])
  .handler(async ({ context }) => {
    const [pages, calendars] = await Promise.all([booking.listPages(context.user.id), myCalendars(context.user.id)]);
    return { pages, calendars: calendars.own };
  });

export const savePage = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => booking.pageInput.parse(d))
  .handler(async ({ data, context }) => booking.savePage(context.user.id, data));

export const setPaused = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), paused: z.boolean() }).strict().parse(d))
  .handler(async ({ data, context }) => booking.setPaused(context.user.id, data.id, data.paused));

export const deletePage = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => booking.deletePage(context.user.id, data.id));
