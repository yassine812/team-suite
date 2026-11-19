import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { bookingByToken, publicPage } from "@/server/booking";

// The public booking pages' first render. Only the page's own facts leave the server.
export const getPublicPage = createServerFn()
  .validator((d: unknown) => z.object({ slug: z.string().max(80) }).parse(d))
  .handler(({ data }) => publicPage(data.slug));

export const getBookingForCancel = createServerFn()
  .validator((d: unknown) => z.object({ token: z.string().max(100) }).parse(d))
  .handler(async ({ data }) => {
    const b = await bookingByToken(data.token);
    return b ? { title: b.title, start: b.start, end: b.end, name: b.name, status: b.status } : null;
  });
