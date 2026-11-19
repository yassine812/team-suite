import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { bindings, MAIL_DOMAIN, tomorrow, ensureMailbox, compose, createEvent } from "./lib.mjs";

const runtime = await startRuntime({ bindings });
try {
  await runtime.assertPrivateAccess(["/mail", "/calendar", "/files", "/meet", "/booking"]);

  // X001: no sign-in of the app's own.
  for (const path of ["/login", "/signin", "/signup", "/logout"]) {
    const res = await runtime.fetch(path, { role: "member" });
    expect(res.status).not.toBe(200);
  }

  const owner = await (await runtime.context("owner")).newPage();
  const member = await (await runtime.context("member")).newPage();
  const db = await runtime.database();

  // Owner's private mail, files and calendar.
  await ensureMailbox(owner, expect, "sam");
  await ensureMailbox(member, expect, "dana");
  await compose(owner, expect, { to: `sam@${MAIL_DOMAIN}`, subject: "Salary review notes", body: "Private notes",
    files: [{ name: "review.txt", mimeType: "text/plain", buffer: Buffer.from("confidential") }] });
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(owner.getByText("Message sent")).toBeVisible();
  const thread = await db.prepare("select id from mail_threads where subject = ? limit 1").bind("Salary review notes").first();
  const attachment = await db.prepare("select id from mail_attachments limit 1").first();
  await member.goto(`/mail/t/${thread.id}`);
  await expect(member.getByTestId("not-found")).toBeVisible();
  await expect(member.getByText("Salary review notes")).toHaveCount(0);
  expect((await runtime.fetch(`/api/mail/attachments/${attachment.id}`, { role: "member" })).status).toBe(404);
  expect((await runtime.fetch(`/api/mail/attachments/${attachment.id}`, { role: "owner" })).status).toBe(200);
  await member.goto("/mail");
  await member.getByTestId("mail-search").fill("Salary");
  await member.getByTestId("mail-search").press("Enter");
  await expect(member.getByTestId("thread-row")).toHaveCount(0);

  await owner.goto("/files");
  await owner.getByTestId("file-upload").setInputFiles({ name: "payroll.txt", mimeType: "text/plain", buffer: Buffer.from("secret figures") });
  await expect(owner.getByTestId("file-row").filter({ hasText: "payroll.txt" })).toBeVisible();
  const file = await db.prepare("select id from file_nodes where name = 'payroll.txt'").first();
  expect((await runtime.fetch(`/api/files/${file.id}`, { role: "member" })).status).toBe(404);
  expect((await runtime.fetch(`/api/files/${file.id}`)).status).toBe(401);
  expect(await (await runtime.fetch(`/api/files/${file.id}`, { role: "owner" })).text()).toBe("secret figures");
  await member.goto("/files");
  await expect(member.getByText("payroll.txt")).toHaveCount(0);
  // A viewer can read but not upload, rename or delete; only the owner changes sharing.
  await owner.getByRole("button", { name: "Actions for payroll.txt" }).click();
  await owner.getByRole("menuitem", { name: "Share" }).click();
  await owner.getByTestId("share-email").fill("member@example.test");
  await owner.getByRole("button", { name: "Viewer" }).click();
  await owner.getByRole("button", { name: "Share", exact: true }).click();
  await expect(owner.getByTestId("share-row").filter({ hasText: "member@example.test" })).toBeVisible();
  expect((await runtime.fetch(`/api/files/${file.id}`, { role: "member" })).status).toBe(200);
  await member.goto("/files?view=shared");
  await member.getByRole("button", { name: "Actions for payroll.txt" }).click();
  await expect(member.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await expect(member.getByRole("menuitem", { name: "Share" })).toHaveCount(0);
  await expect(member.getByRole("menuitem", { name: "Move to trash" })).toHaveCount(0);
  await member.keyboard.press("Escape");
  const upload = new FormData();
  upload.set("file", new Blob(["x"]), "intrude.txt");
  upload.set("parentId", file.id);
  expect((await runtime.fetch("/api/files", { role: "member", method: "POST", body: upload })).status).toBe(404);

  // Calendar: no share means nothing; deleting an event is the organizer's.
  const day = tomorrow();
  await owner.goto("/calendar");
  await owner.getByRole("button", { name: "Agenda", exact: true }).click();
  await createEvent(owner, { title: "Board prep", date: day });
  await expect(owner.getByTestId("event-item").filter({ hasText: "Board prep" })).toBeVisible();
  await member.goto("/calendar");
  await member.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(member.getByText("Board prep")).toHaveCount(0);
  await expect(member.getByTestId("event-item").filter({ hasText: "Busy" })).toHaveCount(0);

  // Booking: the public page shows slots only; a bad cancel token is refused.
  await owner.goto("/booking");
  await owner.getByRole("button", { name: "New booking page" }).click();
  await owner.getByTestId("booking-title").fill("Office hours");
  await owner.getByTestId("booking-slug").fill("sam-office-hours");
  for (const d of [0, 6]) await owner.getByTestId(`avail-day-${d}`).click();
  await owner.getByRole("button", { name: "Save booking page" }).click();
  await expect(owner.getByTestId("booking-page").filter({ hasText: "Office hours" })).toBeVisible();
  const pub = await runtime.fetch("/b/sam-office-hours");
  expect(pub.status).toBe(200);
  const html = await pub.text();
  expect(html).toContain("Office hours");
  expect(html).not.toContain("Board prep");
  const slotsJson = await (await runtime.fetch(`/b/sam-office-hours/slots?date=${day}`)).text();
  expect(slotsJson).not.toContain("Board prep");
  expect((await runtime.fetch("/b/no-such-page/slots?date=" + day)).status).toBe(404);
  expect((await runtime.fetch("/b/cancel/not-a-real-token")).status).toBe(404);
  await member.goto("/booking");
  await expect(member.getByText("Office hours")).toHaveCount(0);

  // Meetings are members only; only the creator can remove or end.
  expect((await runtime.fetch("/meet")).status).toBe(401);
  await owner.goto("/meet");
  await owner.getByTestId("meet-title").fill("Leadership sync");
  await owner.getByRole("button", { name: "New meeting" }).click();
  await expect(owner).toHaveURL(/\/meet\/[a-z0-9-]{10,}$/);
  const roomPath = new URL(owner.url()).pathname;
  expect((await runtime.fetch(roomPath)).status).toBe(401);
  expect([401, 403]).toContain((await runtime.fetch(roomPath, { role: "outsider" })).status);
  await owner.getByRole("button", { name: "Join" }).click();
  await member.goto(roomPath);
  await member.getByRole("button", { name: "Join" }).click();
  await expect(member.getByTestId("participant")).toHaveCount(2);
  await expect(member.getByRole("button", { name: "End for everyone" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // Admin-only team overview.
  await member.goto("/admin");
  await expect(member.getByTestId("admin-only")).toBeVisible();
  await expect(member.getByText("sam@" + MAIL_DOMAIN)).toHaveCount(0);
  await owner.goto("/admin");
  await expect(owner.getByTestId("member-row").filter({ hasText: "dana@" + MAIL_DOMAIN })).toBeVisible();
} finally {
  await runtime.close();
}
