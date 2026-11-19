import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { bindings, MAIL_DOMAIN, tomorrow, ensureMailbox, compose, createEvent } from "./lib.mjs";

const runtime = await startRuntime({ bindings });
try {
  let page = await (await runtime.context("member")).newPage();
  await ensureMailbox(page, expect, "dana");
  await compose(page, expect, { to: `dana@${MAIL_DOMAIN}`, subject: "Notes to self: supplier list", body: "Call the florist on Monday." });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();
  await page.goto("/files");
  await page.getByTestId("file-upload").setInputFiles({ name: "suppliers.txt", mimeType: "text/plain", buffer: Buffer.from("Florist: Petal & Stem") });
  await expect(page.getByTestId("file-row").filter({ hasText: "suppliers.txt" })).toBeVisible();
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await createEvent(page, { title: "Supplier tasting", date: tomorrow() });
  await expect(page.getByTestId("event-item").filter({ hasText: "Supplier tasting" })).toBeVisible();

  const stored = await (await runtime.database()).prepare("select id from file_nodes where name = 'suppliers.txt'").first();
  expect(await (await runtime.fetch(`/api/files/${stored.id}`, { role: "member" })).text()).toBe("Florist: Petal & Stem");

  await runtime.restart();

  page = await (await runtime.context("member")).newPage();
  await page.goto("/mail");
  await expect(page.getByTestId("mailbox-address")).toHaveText(`dana@${MAIL_DOMAIN}`);
  await expect(page.getByTestId("thread-row").filter({ hasText: "supplier list" })).toBeVisible();
  await page.goto("/files");
  await expect(page.getByTestId("file-row").filter({ hasText: "suppliers.txt" })).toBeVisible();
  const file = await (await runtime.database()).prepare("select id from file_nodes where name = 'suppliers.txt'").first();
  expect(await (await runtime.fetch(`/api/files/${file.id}`, { role: "member" })).text()).toBe("Florist: Petal & Stem");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByTestId("event-item").filter({ hasText: "Supplier tasting" })).toBeVisible();
} finally {
  await runtime.close();
}
