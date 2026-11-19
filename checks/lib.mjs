// Shared helpers for the release checks.
export const MAIL_DOMAIN = "team.example";
export const bindings = { MAIL_DOMAIN: { type: "text", value: MAIL_DOMAIN }, STORAGE_QUOTA_MB: { type: "text", value: "10240" } };

export function tomorrow() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Opens Mail and creates the member's address when there is none yet. */
export async function ensureMailbox(page, expect, local) {
  await page.goto("/mail");
  const field = page.getByTestId("mailbox-local-part");
  const address = page.getByTestId("mailbox-address");
  await expect(field.or(address)).toBeVisible();
  if (await field.isVisible()) {
    await field.fill(local);
    await page.getByRole("button", { name: "Create address" }).click();
  }
  await expect(address).toHaveText(`${local}@${MAIL_DOMAIN}`);
}

export async function compose(page, expect, { to, subject, body, files }) {
  await page.getByRole("button", { name: "Compose" }).click();
  await page.getByTestId("compose-to").fill(to);
  await page.getByTestId("compose-subject").fill(subject);
  await page.getByTestId("compose-body").fill(body);
  if (files) await page.getByTestId("compose-files").setInputFiles(files);
}

export async function createEvent(page, { title, date, start = "10:00", end = "11:00", guests = "", location = "", meeting = false }) {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByTestId("event-title").fill(title);
  await page.getByTestId("event-date").fill(date);
  await page.getByTestId("event-start").fill(start);
  await page.getByTestId("event-end").fill(end);
  if (location) await page.getByTestId("event-location").fill(location);
  if (guests) await page.getByTestId("event-guests").fill(guests);
  if (meeting) await page.getByTestId("event-meeting").click();
  await page.getByRole("button", { name: "Save event" }).click();
}

export async function rowAction(page, name, action) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}
