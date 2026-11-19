import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { GatewayRefusalError, sendEmail } from "@every-app/sdk/server";
import { z } from "zod";
import * as cal from "@/server/calendar";
import { memberMiddleware } from "./middleware";

export const getCalendar = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.rangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const [calendars, events, hours] = await Promise.all([
      cal.myCalendars(context.user.id),
      cal.listEvents(context.user.id, data.from, data.to),
      cal.workingHours(context.user.id),
    ]);
    return { calendars, events, hours };
  });

export const getEvent = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const e = await cal.getEvent(context.user.id, data.id);
    return e ? { ...e, meetUrl: e.meetCode ? new URL(`/meet/${e.meetCode}`, appOrigin()).toString() : null } : null;
  });

/** The request's own origin: the app's public address. */
function appOrigin() {
  return new URL(getRequest().url).origin;
}

export const saveEvent = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.eventInput.parse(d))
  .handler(async ({ data, context }) => {
    const result = await cal.saveEvent(env.files, context.user.id, data);
    if ("error" in result || !data.emailGuests || !result.newGuests.length) return { ...result, emailed: false };
    const when = data.allDay ? data.start.slice(0, 10) : `${new Date(data.start).toUTCString()} – ${new Date(data.end).toUTCString()}`;
    try {
      await sendEmail({
        env,
        message: {
          to: result.newGuests,
          subject: `Invitation: ${data.title}`,
          text: [`${context.user.email} invited you to "${data.title}".`, `When: ${when}`, data.location && `Where: ${data.location}`, data.description].filter(Boolean).join("\n"),
          replyTo: context.user.email,
        },
      });
      return { ...result, emailed: true };
    } catch (error) {
      if (error instanceof GatewayRefusalError) return { ...result, emailed: false, emailError: "Invitations couldn't be emailed: sending isn't set up." };
      throw error;
    }
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => cal.deleteEvent(env.files, context.user.id, data.id));

export const respond = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.respondInput.parse(d))
  .handler(async ({ data, context }) => cal.respond(context.user.id, data));

export const createCalendar = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.calendarInput.parse(d))
  .handler(async ({ data, context }) => cal.createCalendar(context.user.id, data));

export const deleteCalendar = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => cal.deleteCalendar(env.files, context.user.id, data.id));

export const shareCalendar = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.shareCalendarInput.parse(d))
  .handler(async ({ data, context }) => cal.shareCalendar(context.user.id, data));

export const calendarShares = createServerFn()
  .middleware([memberMiddleware])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => cal.calendarShareList(context.user.id, data.id));

export const teammatesBusy = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.busyInput.parse(d))
  .handler(async ({ data, context }) => cal.teammatesBusy(context.user.id, data));

export const setWorkingHours = createServerFn({ method: "POST" })
  .middleware([memberMiddleware])
  .validator((d: unknown) => cal.hoursInput.parse(d))
  .handler(async ({ data, context }) => cal.setWorkingHours(context.user.id, data));
