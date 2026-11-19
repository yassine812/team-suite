import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
import { computeSlots, zonedTime } from "./slots";
import { messageIds, parseAddressList, replySubject } from "./mime";
import { localPartProblem } from "./mail";

const base = { timeZone: "UTC", windows: [{ day: 1, start: "09:00", end: "11:00" }], duration: 30, buffer: 0, minNotice: 0, horizonDays: 30, now: new Date("2026-01-01T00:00:00Z") };

describe("booking slots", () => {
  it("fills the window and skips busy time", () => {
    const slots = computeSlots({ ...base, date: "2026-01-05", busy: [{ start: "2026-01-05T09:30:00Z", end: "2026-01-05T10:00:00Z" }] });
    expect(slots).toEqual(["2026-01-05T09:00:00.000Z", "2026-01-05T10:00:00.000Z", "2026-01-05T10:30:00.000Z"]);
  });
  it("keeps the buffer around busy time and respects notice and horizon", () => {
    expect(computeSlots({ ...base, buffer: 30, date: "2026-01-05", busy: [{ start: "2026-01-05T10:00:00Z", end: "2026-01-05T10:30:00Z" }] })).toEqual(["2026-01-05T09:00:00.000Z"]);
    expect(computeSlots({ ...base, date: "2026-01-05", busy: [], now: new Date("2026-01-05T09:45:00Z"), minNotice: 30 })).toEqual(["2026-01-05T10:30:00.000Z"]);
    expect(computeSlots({ ...base, date: "2026-03-02", busy: [] })).toEqual([]);
  });
  it("reads windows in the page's zone", () => {
    expect(zonedTime("2026-07-06", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-06T07:00:00.000Z");
  });
});

describe("mail helpers", () => {
  it("parses recipients and threading headers", () => {
    expect(parseAddressList("a@x.com, Bo <B@Y.com>")).toEqual([{ address: "a@x.com" }, { address: "b@y.com", name: "Bo" }]);
    expect(parseAddressList("not an address")).toBeNull();
    expect(messageIds("<a@x> <b@y>")).toEqual(["<a@x>", "<b@y>"]);
    expect(replySubject("Re: Hi", "Re")).toBe("Re: Hi");
  });
  it("refuses reserved and malformed addresses", () => {
    expect(localPartProblem("postmaster")).toMatch(/reserved/);
    expect(localPartProblem("Bad Name")).toMatch(/letters/);
    expect(localPartProblem("dana")).toBeNull();
  });
});
