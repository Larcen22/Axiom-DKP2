/**
 * Unit tests for js/metrics.js — attendance-metric helpers behind the Overview
 * "Declining Attendance" and "Returning Raiders" panels.
 *
 * Strategy: load metrics.js via CommonJS require (see export guard at its bottom)
 * and run the pure functions against a synthetic fixture with an explicit asOf
 * date, so results are deterministic regardless of when the suite runs.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Metrics = require("../../js/metrics.js");

// asOf 2026-07-01 → recent window starts 2026-06-01 (inclusive), prior window
// starts 2026-05-02 (inclusive). Raids before 2026-05-02 fall outside both.
const AS_OF = "2026-07-01";

function raid(date, chars, uids = []) {
  return { date, attendees: chars, attendeeUserIds: uids };
}

// Character names in `attendees` (real-data shape); some raids also carry the
// same member's usernameId to exercise uid matching and name+uid de-duplication.
const raids = [
  raid("2026-03-01", ["Jacko"]),
  raid("2026-04-01", ["Gracia"]),
  raid("2026-05-03", ["Bora", "Fira"]), // Fira pre-dates Frank's join → ignored for him
  raid("2026-05-04", ["Cira"]),
  raid("2026-05-05", ["Aldric"]),
  raid("2026-05-06", ["Evelyn"], ["u-ev"]), // name + uid on same raid → counts once
  raid("2026-05-11", ["Cira"]),
  raid("2026-05-12", ["Aldric"], ["u-al"]),
  raid("2026-05-13", ["Evelyn"]),
  raid("2026-05-14", ["Fira"]),
  raid("2026-05-17", ["Bora"]),
  raid("2026-05-18", ["Cira"]),
  raid("2026-05-19", ["Aldric", "Mystery"]), // unknown character → attributed to nobody
  raid("2026-05-20", ["Hanko", "Evelyn"], ["u-ha", "u-ev"]),
  raid("2026-05-21", ["Fira"]),
  raid("2026-05-25", ["Cira"]),
  raid("2026-05-26", ["Aldric"]),
  raid("2026-05-27", ["Evelyn"]),
  raid("2026-05-28", ["Fira"]),
  raid("2026-05-31", ["Bora"]),
  raid("2026-06-05", ["Cira"]),
  raid("2026-06-10", ["Hanko"], ["u-ha"]),
  raid("2026-06-15", ["Bora"]),
  raid("2026-06-19", ["Cira"], ["u-ca"]), // de-dup: Carol's recent stays at 2
  raid("2026-06-20", ["Gracia"]),
  raid("2026-06-25", ["Irisu"]),
  raid("2026-07-08", ["Evelyn"], ["u-ev"]), // future-dated → excluded from "recent"
];

const roster = [
  { member: "Alice", character: "Aldric", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Bob", character: "Bora", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Carol", character: "Cira", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Eve", character: "Evelyn", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Frank", character: "Fira", applied: "2026-05-10", memberSince: "2026-05-10" },
  { member: "Grace", character: "Gracia", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Hank", character: "Hanko", applied: "2026-01-01", memberSince: "2026-01-15" },
  { member: "Iris", character: "Irisu", applied: "2026-06-01", memberSince: "2026-06-01" },
  { member: "Jack", character: "Jacko", applied: "2026-01-01", memberSince: "2026-01-15" },
];

const users = [
  { username: "Alice", usernameId: "u-al" },
  { username: "Bob", usernameId: "u-bo" },
  { username: "Carol", usernameId: "u-ca" },
  { username: "Eve", usernameId: "u-ev" },
  { username: "Frank", usernameId: "u-fr" },
  { username: "Grace", usernameId: "u-gr" },
  { username: "Hank", usernameId: "u-ha" },
  { username: "Iris", usernameId: "u-ir" },
  { username: "Jack", usernameId: "u-jk" },
];

describe("metrics.daysBefore / dayDiff", () => {
  it("computes window boundaries and gaps", () => {
    expect(Metrics.daysBefore(AS_OF, 30)).toBe("2026-06-01");
    expect(Metrics.daysBefore(AS_OF, 60)).toBe("2026-05-02");
    expect(Metrics.dayDiff("2026-04-01", "2026-06-20")).toBe(80);
  });
});

describe("metrics.attendanceByMember", () => {
  const byName = new Map(Metrics.attendanceByMember(raids, roster, users).map((m) => [m.member, m]));

  it("attributes raids via character name and usernameId, de-duplicating both on one raid", () => {
    expect(byName.get("Alice").dates).toEqual(["2026-05-05", "2026-05-12", "2026-05-19", "2026-05-26"]);
    expect(byName.get("Eve").dates).toEqual(["2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27", "2026-07-08"]);
    expect(byName.get("Carol").dates).toEqual(["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25", "2026-06-05", "2026-06-19"]);
  });

  it("ignores raids before the member's join date (min of applied / memberSince)", () => {
    expect(byName.get("Frank").joinDate).toBe("2026-05-10");
    expect(byName.get("Frank").dates).toEqual(["2026-05-14", "2026-05-21", "2026-05-28"]); // 2026-05-03 excluded
  });

  it("covers every roster member exactly once, with sorted dates and usernameId", () => {
    const members = [...byName.keys()].sort();
    expect(members).toEqual(["Alice", "Bob", "Carol", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack"]);
    for (const m of byName.values()) {
      expect(m.dates).toEqual([...m.dates].sort());
      expect(typeof m.usernameId).toBe("string");
    }
  });
});

describe("metrics.findDecliningMembers", () => {
  it("flags members with 4+ raids in days 60–31 and ≤1 in the last 30, ignoring future dates", () => {
    const out = Metrics.findDecliningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF });
    expect(out).toEqual([
      { member: "Alice", usernameId: "u-al", prior: 4, recent: 0 }, // future raid (2026-07-08) not counted for Eve…
      { member: "Eve", usernameId: "u-ev", prior: 4, recent: 0 },   // …and Alice dropped to zero
    ]);
  });

  it("does not flag members who kept raiding (Bob: only 3 prior; Carol: 2 recent)", () => {
    const out = Metrics.findDecliningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF });
    expect(out.map((m) => m.member)).not.toContain("Bob");
    expect(out.map((m) => m.member)).not.toContain("Carol");
  });

  it("honors custom thresholds", () => {
    const out = Metrics.findDecliningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF, minPrior: 3, maxRecent: 1 });
    expect(out.map((m) => m.member)).toContain("Bob"); // prior=3, recent=1 now qualifies
  });
});

describe("metrics.findReturningMembers", () => {
  it("flags members back after a gap of 45+ days with the return date and gap size", () => {
    const out = Metrics.findReturningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF });
    expect(out).toEqual([
      { member: "Grace", usernameId: "u-gr", returnDate: "2026-06-20", lastSeen: "2026-06-20", gapDays: 80 },
    ]);
  });

  it("excludes short gaps (Hank: 21d), new joiners (Iris) and members still absent (Jack)", () => {
    const out = Metrics.findReturningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF });
    expect(out.map((m) => m.member)).toEqual(["Grace"]);
  });

  it("honors a smaller minGapDays", () => {
    const out = Metrics.findReturningMembers(Metrics.attendanceByMember(raids, roster, users), { asOf: AS_OF, minGapDays: 21 });
    expect(out.map((m) => m.member)).toContain("Hank"); // gap of exactly 21 days now qualifies
  });
});
