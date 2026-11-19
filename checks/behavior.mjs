import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { bindings, MAIL_DOMAIN, tomorrow, ensureMailbox, compose, createEvent, rowAction } from "./lib.mjs";

const runtime = await startRuntime({ bindings });
try {
  const member = await (await runtime.context("member")).newPage();
  const owner = await (await runtime.context("owner")).newPage();

  // F001: addresses are picked once, unique and not reserved.
  await member.goto("/mail");
  await member.getByTestId("mailbox-local-part").fill("postmaster");
  await member.getByRole("button", { name: "Create address" }).click();
  await expect(member.getByRole("alert")).toContainText("reserved");
  await ensureMailbox(member, expect, "dana");
  await owner.goto("/mail");
  await owner.getByTestId("mailbox-local-part").fill("dana");
  await owner.getByRole("button", { name: "Create address" }).click();
  await expect(owner.getByRole("alert")).toContainText("taken");
  await ensureMailbox(owner, expect, "sam");

  // F001: send to a teammate with an attachment; a sent copy is kept.
  await compose(member, expect, { to: `sam@${MAIL_DOMAIN}`, subject: "Venue shortlist for the March offsite",
    body: "Hi Sam,\n\nI narrowed it to three venues. The floor plan is attached.\n\nDana",
    files: [{ name: "floorplan.txt", mimeType: "text/plain", buffer: Buffer.from("Hall A: 120 seats\nHall B: 80 seats") }] });
  await member.getByRole("button", { name: "Send" }).click();
  await expect(member.getByText("Message sent")).toBeVisible();
  await member.getByTestId("folder-sent").click();
  await expect(member.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();

  // Received, opened in a sandboxed frame, attachment saved to Files.
  await owner.goto("/mail");
  const row = owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(owner.getByRole("heading", { name: "Venue shortlist for the March offsite" })).toBeVisible();
  await expect(owner.getByTestId("message-body").first()).toHaveAttribute("sandbox", "");
  await expect(owner.frameLocator('[data-testid="message-body"]').first().getByText("narrowed it to three venues")).toBeVisible();
  await expect(owner.getByTestId("attachment").filter({ hasText: "floorplan.txt" })).toBeVisible();
  await owner.getByRole("button", { name: "Save floorplan.txt to Files" }).click();
  await expect(owner.getByText("Saved to Files")).toBeVisible();

  // Labels, star, unread, reply.
  await owner.getByTestId("label-input").fill("Offsite");
  await owner.getByRole("button", { name: "Add label" }).click();
  await expect(owner.getByTestId("thread-label").filter({ hasText: "Offsite" })).toBeVisible();
  await owner.getByRole("button", { name: "Star" }).click();
  await expect(owner.getByRole("button", { name: "Unstar" })).toBeVisible();
  await owner.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(owner.getByTestId("compose-to")).toHaveValue(`dana@${MAIL_DOMAIN}`);
  await expect(owner.getByTestId("compose-subject")).toHaveValue("Re: Venue shortlist for the March offsite");
  // F006: AI help is a state, not a crash, when no provider is connected.
  await owner.getByTestId("ai-prompt").fill("Thank Dana and pick the second venue");
  await owner.getByRole("button", { name: "Draft" }).click();
  await expect(owner.getByTestId("ai-off")).toBeVisible();
  await owner.getByTestId("compose-body").fill("Thanks Dana, the second venue works for me.");
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(owner.getByTestId("message")).toHaveCount(2);
  const calls = await runtime.gatewayCalls();
  expect(JSON.stringify(calls)).toMatch(/ai/);

  // The reply joins the same thread for Dana.
  await member.goto("/mail");
  await member.getByTestId("thread-row").filter({ hasText: "Venue shortlist" }).click();
  await expect(member.getByTestId("message")).toHaveCount(2);
  await member.getByRole("button", { name: "Mark unread" }).click();
  await member.goto("/mail");
  await expect(member.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toHaveAttribute("data-unread", "true");

  // Search, starred, labels, archive, trash, restore and empty trash.
  await owner.goto("/mail");
  await owner.getByTestId("mail-search").fill("three venues");
  await owner.getByTestId("mail-search").press("Enter");
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();
  await owner.getByTestId("folder-starred").click();
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();
  await owner.getByRole("link", { name: "Offsite", exact: true }).click();
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();
  await owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" }).click();
  await owner.getByRole("button", { name: "Archive" }).click();
  await owner.getByTestId("folder-archive").click();
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();
  await owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" }).click();
  await owner.getByRole("button", { name: "Trash" }).click();
  await owner.getByTestId("folder-trash").click();
  await owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" }).click();
  await owner.getByRole("button", { name: "Restore" }).click();
  await owner.getByTestId("folder-trash").click();
  await expect(owner.getByTestId("thread-row")).toHaveCount(0);
  await owner.getByTestId("folder-archive").click();
  await owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" }).click();
  await owner.getByRole("button", { name: "Move to Inbox" }).click();
  await owner.getByTestId("folder-inbox").click();
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();

  // Mail outside the team needs the email capability; without it the page says so.
  await compose(member, expect, { to: "planner@venues.example", subject: "Booking request", body: "Is March 12 free?" });
  await member.getByRole("button", { name: "Send" }).click();
  await expect(member.getByTestId("compose-error")).toBeVisible();
  expect(JSON.stringify(await runtime.gatewayCalls())).toMatch(/email/);
  await member.keyboard.press("Escape");

  // F005: folders, upload, preview, rename, star, search, share, trash.
  await member.goto("/files");
  await expect(member.getByTestId("storage-usage")).toContainText("of 10 GB");
  await member.getByRole("button", { name: "New folder" }).click();
  await member.getByTestId("folder-name").fill("Offsite planning");
  await member.getByRole("button", { name: "Create" }).click();
  await member.getByRole("link", { name: "Offsite planning" }).click();
  await expect(member.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "Offsite planning" })).toBeVisible();
  await member.getByTestId("file-upload").setInputFiles({ name: "agenda.txt", mimeType: "text/plain", buffer: Buffer.from("Day 1: arrivals and welcome dinner") });
  await expect(member.getByTestId("file-row").filter({ hasText: "agenda.txt" })).toBeVisible();
  await rowAction(member, "agenda.txt", "Preview");
  await expect(member.getByTestId("file-preview")).toContainText("welcome dinner");
  await member.keyboard.press("Escape");
  await rowAction(member, "agenda.txt", "Rename");
  await member.getByTestId("rename-input").fill("offsite-agenda.txt");
  await member.getByRole("button", { name: "Rename" }).click();
  await expect(member.getByTestId("file-row").filter({ hasText: "offsite-agenda.txt" })).toBeVisible();
  await rowAction(member, "offsite-agenda.txt", "Star");
  await member.getByRole("link", { name: "Starred" }).click();
  await expect(member.getByTestId("file-row").filter({ hasText: "offsite-agenda.txt" })).toBeVisible();
  await member.getByRole("link", { name: "My files" }).click();
  await member.getByTestId("file-search").fill("agenda");
  await member.getByTestId("file-search").press("Enter");
  await expect(member.getByTestId("file-row").filter({ hasText: "offsite-agenda.txt" })).toBeVisible();
  await member.getByRole("link", { name: "My files" }).click();
  await rowAction(member, "Offsite planning", "Share");
  await member.getByTestId("share-email").fill("owner@example.test");
  await member.getByRole("button", { name: "Editor" }).click();
  await member.getByRole("button", { name: "Share", exact: true }).click();
  await expect(member.getByTestId("share-row").filter({ hasText: "owner@example.test" })).toBeVisible();
  await member.keyboard.press("Escape");
  await owner.goto("/files");
  await owner.getByRole("link", { name: "Shared with me" }).click();
  await owner.getByRole("link", { name: "Offsite planning" }).click();
  await expect(owner.getByTestId("file-row").filter({ hasText: "offsite-agenda.txt" })).toBeVisible();
  await owner.getByTestId("file-upload").setInputFiles({ name: "budget.txt", mimeType: "text/plain", buffer: Buffer.from("Venue: 4200") });
  await expect(owner.getByTestId("file-row").filter({ hasText: "budget.txt" })).toBeVisible();
  // Saved mail attachment is in the owner's own files.
  await owner.getByRole("link", { name: "My files" }).click();
  await expect(owner.getByTestId("file-row").filter({ hasText: "floorplan.txt" })).toBeVisible();
  await member.goto("/files");
  await rowAction(member, "Offsite planning", "Move to trash");
  await member.getByRole("link", { name: "Trash" }).click();
  await rowAction(member, "Offsite planning", "Restore");
  await member.getByRole("link", { name: "My files" }).click();
  await expect(member.getByTestId("file-row").filter({ hasText: "Offsite planning" })).toBeVisible();

  // F002: calendars, guests and answers, sharing, views.
  const day = tomorrow();
  await member.goto("/calendar");
  await member.getByRole("button", { name: "Agenda", exact: true }).click();
  await createEvent(member, { title: "Venue walkthrough", date: day, start: "10:00", end: "11:00", location: "Hall A", guests: "owner@example.test", meeting: true });
  await expect(member.getByTestId("event-item").filter({ hasText: "Venue walkthrough" })).toBeVisible();
  await owner.goto("/calendar");
  await owner.getByRole("button", { name: "Agenda", exact: true }).click();
  await owner.getByTestId("event-item").filter({ hasText: "Venue walkthrough" }).click();
  await expect(owner.getByRole("button", { name: "Delete event" })).toHaveCount(0);
  await owner.getByRole("button", { name: "Maybe" }).click();
  await expect(owner.getByTestId("guest-response").filter({ hasText: "owner@example.test" })).toContainText("Maybe");
  await owner.keyboard.press("Escape");
  await member.reload();
  await member.getByRole("button", { name: "Agenda", exact: true }).click();
  await member.getByTestId("event-item").filter({ hasText: "Venue walkthrough" }).click();
  await expect(member.getByTestId("guest-response").filter({ hasText: "owner@example.test" })).toContainText("Maybe");
  const meetHref = await member.getByTestId("event-meeting-link").getAttribute("href");
  expect(new URL(meetHref).hostname).toBe(runtime.hostname);
  await member.keyboard.press("Escape");
  for (const view of ["Day", "Week", "Month"]) {
    await member.getByRole("button", { name: view, exact: true }).click();
    await expect(member.getByTestId(`view-${view.toLowerCase()}`)).toBeVisible();
  }
  // Working hours.
  await member.getByRole("button", { name: "Working hours" }).click();
  await member.getByTestId("work-start").fill("08:00");
  await member.getByRole("button", { name: "Save hours" }).click();
  await expect(member.getByText("Working hours saved")).toBeVisible();
  // Share free/busy only with the owner, who sees Busy and no title.
  await member.getByRole("button", { name: "Share calendar" }).first().click();
  await member.getByTestId("share-email").fill("owner@example.test");
  await member.getByRole("button", { name: "Free/busy" }).click();
  await member.getByRole("button", { name: "Share", exact: true }).click();
  await expect(member.getByTestId("share-row").filter({ hasText: "owner@example.test" })).toBeVisible();
  await member.keyboard.press("Escape");
  await createEvent(member, { title: "Dentist", date: day, start: "15:00", end: "16:00" });
  await owner.reload();
  await owner.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(owner.getByTestId("event-item").filter({ hasText: "Busy" })).toBeVisible();
  await expect(owner.getByText("Dentist")).toHaveCount(0);
  // Scheduling with a teammate overlays their busy time.
  await owner.getByRole("button", { name: "New event" }).click();
  await owner.getByTestId("event-date").fill(day);
  await owner.getByTestId("event-guests").fill("member@example.test");
  await expect(owner.getByTestId("guest-busy")).toContainText("15:00");
  await owner.keyboard.press("Escape");

  // F003: booking page, public slots, atomic booking, cancel.
  await member.goto("/booking");
  await member.getByRole("button", { name: "New booking page" }).click();
  await member.getByTestId("booking-title").fill("Intro call with Dana");
  await member.getByTestId("booking-slug").fill("dana-intro");
  await member.getByTestId("booking-duration").fill("30");
  for (const d of [0, 6]) await member.getByTestId(`avail-day-${d}`).click();
  await member.getByRole("button", { name: "Save booking page" }).click();
  await expect(member.getByTestId("booking-page").filter({ hasText: "Intro call with Dana" })).toBeVisible();
  const visitor = await (await runtime.context(null)).newPage();
  await visitor.goto("/b/dana-intro");
  await expect(visitor.getByRole("heading", { name: "Intro call with Dana" })).toBeVisible();
  await expect(visitor.getByText("Venue walkthrough")).toHaveCount(0);
  await visitor.getByTestId(`day-${day}`).click();
  const slots = await (await runtime.fetch(`/b/dana-intro/slots?date=${day}`)).json();
  expect(slots.slots.length).toBeGreaterThan(0);
  const busyStart = new Date(`${day}T10:00:00Z`).toISOString();
  expect(slots.slots).not.toContain(busyStart);
  await visitor.getByTestId("slot").first().click();
  await visitor.getByTestId("booker-name").fill("Priya Raman");
  await visitor.getByTestId("booker-email").fill("priya@client.example");
  await visitor.getByTestId("booker-note").fill("Planning a 40-person retreat");
  await visitor.getByRole("button", { name: "Book" }).click();
  await expect(visitor.getByTestId("booking-confirmed")).toBeVisible();
  const cancelHref = await visitor.getByTestId("cancel-link").getAttribute("href");
  expect(new URL(cancelHref).hostname).toBe(runtime.hostname);
  const twice = await runtime.fetch("/b/dana-intro/book", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ start: slots.slots[0], name: "Late Comer", email: "late@client.example", note: "" }) });
  expect(twice.status).toBe(409);
  await member.reload();
  await expect(member.getByTestId("booking-row").filter({ hasText: "Priya Raman" })).toBeVisible();
  await visitor.goto(new URL(cancelHref).pathname);
  await visitor.getByRole("button", { name: "Cancel booking" }).click();
  await expect(visitor.getByTestId("booking-cancelled")).toBeVisible();
  const again = await (await runtime.fetch(`/b/dana-intro/slots?date=${day}`)).json();
  expect(again.slots).toContain(slots.slots[0]);
  await member.getByRole("button", { name: "Pause" }).click();
  await expect(member.getByRole("button", { name: "Resume" })).toBeVisible();
  expect((await (await runtime.fetch(`/b/dana-intro/slots?date=${day}`)).json()).slots).toEqual([]);

  // F004: a room with participants, chat, removal and ending.
  await member.goto("/meet");
  await member.getByTestId("meet-title").fill("Offsite planning sync");
  await member.getByRole("button", { name: "New meeting" }).click();
  await expect(member).toHaveURL(/\/meet\/[a-z0-9-]{10,}$/);
  const roomPath = new URL(member.url()).pathname;
  await member.getByRole("button", { name: "Join" }).click();
  await owner.goto(roomPath);
  await owner.getByRole("button", { name: "Join" }).click();
  await expect(member.getByTestId("participant")).toHaveCount(2);
  await owner.getByTestId("chat-input").fill("Joining from the hotel lobby");
  await owner.getByRole("button", { name: "Send message" }).click();
  await expect(member.getByTestId("chat-message").filter({ hasText: "hotel lobby" })).toBeVisible();
  await member.getByRole("button", { name: "Mute" }).click();
  await expect(member.getByRole("button", { name: "Unmute" })).toBeVisible();
  await member.getByRole("button", { name: "Remove owner@example.test" }).click();
  await expect(owner.getByTestId("call-ended")).toBeVisible();
  await expect(member.getByTestId("participant")).toHaveCount(1);
  await member.getByRole("button", { name: "End for everyone" }).click();
  await expect(member.getByTestId("call-ended")).toBeVisible();

  // Phone-sized smoke.
  const phone = await (await runtime.context("member", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto("/mail");
  await expect(phone.getByTestId("mailbox-address")).toBeVisible();
  await runtime.assertBackLink(phone);

  // Journey ends on the inbox with real mail on screen.
  await member.goto("/mail");
  await compose(member, expect, { to: `sam@${MAIL_DOMAIN}`, subject: "Catering options for day two", body: "Three caterers replied. Lunch quotes are in the shared folder." });
  await member.getByRole("button", { name: "Send" }).click();
  await expect(member.getByText("Message sent")).toBeVisible();
  await owner.goto("/mail");
  await runtime.assertBackLink(owner);
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Catering options" })).toBeVisible();
  await expect(owner.getByTestId("thread-row").filter({ hasText: "Venue shortlist" })).toBeVisible();
  await runtime.screenshot(owner);
} finally {
  await runtime.close();
}
