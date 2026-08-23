/**
 * Data integrity tests — cross-file invariants for the DKP exports.
 *
 * These run against the REAL items.json / loot.json / raids.json / users.json /
 * transactions.json (optional) / roster-export.csv at the repo root and catch
 * bad exports before they break
 * the dashboard's joins (loot -> raids, characters -> users, item names -> pqdi ids).
 *
 * Thresholds were calibrated against a known-good export:
 *   - spent == Σ loot is exact for 100% of users        -> hard assert
 *   - earned drifts ≤ ±100 per user (manual adjustments) -> hard assert on bound
 *   - item name coverage ~99%                            -> hard assert ≥ 95%
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The data exports are committed to the repo (owner decision 2026-08-23). When
// present, validate the REAL exports; otherwise fall back to a known-good sample dataset.
const DATA_FILES = ["loot.json", "raids.json", "users.json", "roster-export.csv"];
const hasRealData = DATA_FILES.every((f) => fs.existsSync(path.join(ROOT, f)));
const DATA_DIR = hasRealData ? ROOT : path.join(ROOT, "test/fixtures/sample-data");
console.log(`  validating data from: ${path.relative(ROOT, DATA_DIR) || "."}`);

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));

/* Load once for the whole file. */
const items = JSON.parse(fs.readFileSync(path.join(ROOT, "items.json"), "utf8"));
const loot = readJson("loot.json");
const raids = readJson("raids.json");
const users = readJson("users.json");
const rosterCsv = fs.readFileSync(path.join(DATA_DIR, "roster-export.csv"), "utf8");

/* Parse the roster with papaparse — same parser (and options) as production data.js. */
const rosterParsed = Papa.parse(rosterCsv, {
  header: true,
  skipEmptyLines: true,
  trimHeaders: true,
  transform: (v) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : v),
});
const roster = rosterParsed.data;

/* transactions.json is optional for the app (hosted deployments may lack it) — validate when present. */
const hasTransactions = fs.existsSync(path.join(DATA_DIR, "transactions.json"));
const tx = hasTransactions ? readJson("transactions.json") : null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------- structure ---------------- */

describe("file structure", () => {
  it("items.json has { table: 'items', rows: [{ id, NAME }] }", () => {
    expect(items.table).toBe("items");
    expect(Array.isArray(items.rows)).toBe(true);
    expect(items.rows.length).toBeGreaterThan(0);
    for (const r of items.rows) {
      expect(typeof r.id, `item row missing numeric id: ${JSON.stringify(r)}`).toBe("number");
      expect(typeof r.NAME, `item row missing string NAME: ${JSON.stringify(r)}`).toBe("string");
    }
  });

  it("loot.json rows carry the join fields", () => {
    expect(Array.isArray(loot.loot)).toBe(true);
    expect(loot.loot.length).toBeGreaterThan(0);
    for (const l of loot.loot) {
      expect(typeof l.item, `loot row missing item: ${JSON.stringify(l)}`).toBe("string");
      expect(typeof l.character_name, `loot row missing character_name`).toBe("string");
      expect(l.raid_id != null, `loot row missing raid_id: ${l.item} / ${l.character_name}`).toBeTruthy();
    }
  });

  it("raids.json rows carry id, date and attendees", () => {
    expect(Array.isArray(raids.raids)).toBe(true);
    expect(raids.raids.length).toBeGreaterThan(0);
    for (const r of raids.raids) {
      expect(r.raid_id != null, `raid missing raid_id: ${r.raid_name}`).toBeTruthy();
      expect(typeof r.date === "string" && ISO_DATE.test(String(r.date).slice(0, 10)),
        `bad raid date: ${JSON.stringify({ id: r.raid_id, date: r.date })}`).toBe(true);
      expect(Array.isArray(r.attendees), `attendees not an array for raid ${r.raid_id}`).toBe(true);
    }
  });

  it("users.json rows carry username + DKP fields", () => {
    expect(Array.isArray(users.users)).toBe(true);
    expect(users.users.length).toBeGreaterThan(0);
    for (const u of users.users) {
      expect(typeof u.username, `user missing username: ${JSON.stringify(u)}`).toBe("string");
      expect(u.username_id != null, `user ${u.username} missing username_id`).toBeTruthy();
      for (const f of ["available_dkp", "dkp_earned", "dkp_spent"]) {
        // New applicants may lack dkp_earned entirely; data.js treats that as 0.
        const v = u[f];
        expect(v == null || Number.isFinite(Number(v)), `user ${u.username}: ${f} not numeric (${v})`).toBe(true);
      }
    }
  });

  it("roster CSV parses with the expected headers", () => {
    const required = ["MemberName", "CharacterName", "Class", "Level", "Race", "Main/Alt", "Rank",
      "AvailableDKP", "EarnedDKP", "SpentDKP"];
    for (const h of required) expect(rosterParsed.meta.fields, `missing CSV header: ${h}`).toContain(h);
    expect(roster.length).toBeGreaterThan(0);
  });
});

/* ---------------- uniqueness & dates ---------------- */

describe("uniqueness", () => {
  it("raid_ids are unique", () => {
    const ids = raids.raids.map((r) => r.raid_id);
    expect(new Set(ids).size, "duplicate raid_ids found").toBe(ids.length);
  });

  it("item ids are unique", () => {
    const ids = items.rows.map((r) => r.id);
    expect(new Set(ids).size, "duplicate item ids found").toBe(ids.length);
  });

  it("username_id is unique across users.json", () => {
    const ids = users.users.map((u) => String(u.username_id));
    expect(new Set(ids).size, "duplicate username_ids found").toBe(ids.length);
  });
});

describe("dates", () => {
  it("loot rows with an own date use ISO YYYY-MM-DD", () => {
    const bad = loot.loot.filter((l) => l.date && !ISO_DATE.test(String(l.date).slice(0, 10)));
    expect(bad.map((l) => `${l.item}/${l.character_name}:${l.date}`), "non-ISO loot dates").toEqual([]);
  });

  it("no raid is dated in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    const bad = raids.raids.filter((r) => String(r.date).slice(0, 10) > today);
    expect(bad.map((r) => `${r.raid_id}:${r.date}`), "future-dated raids").toEqual([]);
  });
});

/* ---------------- transactions.json (optional export) ---------------- */

describe("transactions.json", () => {
  const txs = tx ? tx.transactions : null;

  it("has { transactions: [...] } with well-formed rows when present", () => {
    if (!txs) return; // optional file — skipped when absent
    expect(Array.isArray(txs)).toBe(true);
    for (const t of txs) {
      expect(typeof t.transaction_id, `row missing transaction_id: ${JSON.stringify(t)}`).toBe("string");
      expect(Number.isFinite(Number(t.transaction_amount)), `non-numeric amount: ${JSON.stringify(t)}`).toBe(true);
    }
  });

  it("transaction_ids are unique", () => {
    if (!txs) return;
    const ids = txs.map((t) => String(t.transaction_id));
    expect(new Set(ids).size, "duplicate transaction_ids found").toBe(ids.length);
  });

  it("dates use ISO YYYY-MM-DD (or are empty)", () => {
    if (!txs) return;
    const bad = txs.filter((t) => t.date && !ISO_DATE.test(String(t.date).slice(0, 10)));
    expect(bad.map((t) => `${t.transaction_id}:${t.date}`), "non-ISO transaction dates").toEqual([]);
  });

  it("reports username_ids not found in users.json (informational)", () => {
    if (!txs) return;
    const userIds = new Set(users.users.map((u) => String(u.username_id)));
    const orphans = txs.filter((t) => !userIds.has(String(t.username_id)));
    console.log(`  transactions with username_id not in users.json: ${orphans.length}`);
  });
});

/* ---------------- referential integrity (hard) ---------------- */

describe("referential integrity", () => {
  const raidIds = new Set(raids.raids.map((r) => r.raid_id));
  const userIds = new Set(users.users.map((u) => String(u.username_id)));
  const userNames = new Set(users.users.map((u) => u.username.toLowerCase()));
  const rosterMembers = new Set(roster.map((r) => r.MemberName).filter(Boolean).map((m) => m.toLowerCase()));
  const rosterChars = new Set(roster.map((r) => r.CharacterName).filter(Boolean));

  it("every loot.raid_id exists in raids.json", () => {
    const orphans = loot.loot.filter((l) => !raidIds.has(l.raid_id));
    expect(orphans.slice(0, 5).map((l) => `${l.item}/${l.character_name}->${l.raid_id}`),
      "loot rows pointing at unknown raids").toEqual([]);
  });

  it("every loot.username_id exists in users.json", () => {
    const orphans = loot.loot.filter((l) => !userIds.has(String(l.username_id)));
    expect(orphans.length, `loot rows with username_id not in users.json (${orphans.length})`).toBe(0);
  });

  it("roster members and users.json usernames match exactly (both directions)", () => {
    const onlyRoster = [...rosterMembers].filter((m) => !userNames.has(m));
    const onlyUsers = [...userNames].filter((m) => !rosterMembers.has(m));
    expect(onlyRoster, "members in roster CSV but not users.json").toEqual([]);
    expect(onlyUsers, "users in users.json but not roster CSV").toEqual([]);
  });

  it("every character listed in users[].characters exists in the roster CSV", () => {
    const missing = [];
    for (const u of users.users) {
      for (const c of u.characters || []) {
        if (!rosterChars.has(c.name)) missing.push(`${u.username}/${c.name}`);
      }
    }
    expect(missing, "user characters absent from roster CSV").toEqual([]);
  });

  it("≥75% of loot characters still appear in the roster CSV", () => {
    // Retired/deleted characters keep their historical loot but leave the roster;
    // a large orphan share would indicate a broken export.
    const all = [...new Set(loot.loot.map((l) => l.character_name))];
    const orphans = all.filter((c) => !rosterChars.has(c));
    console.log(`  loot character coverage: ${all.length - orphans.length}/${all.length} (${orphans.length} retired/unknown)`);
    expect(1 - orphans.length / all.length, "too many loot characters missing from roster CSV").toBeGreaterThanOrEqual(0.75);
  });
});

/* ---------------- DKP invariants ---------------- */

describe("DKP consistency", () => {
  const spentFromLoot = new Map();
  for (const l of loot.loot) {
    if (!l.username_id) continue;
    spentFromLoot.set(String(l.username_id), (spentFromLoot.get(String(l.username_id)) || 0) + (Number(l.item_dkp_value) || 0));
  }

  const earnedFromRaids = new Map();
  for (const r of raids.raids) {
    const v = Number(r.raid_dkp_value) || 0;
    for (const a of r.attendees || []) {
      if (!a.username_id) continue;
      earnedFromRaids.set(String(a.username_id), (earnedFromRaids.get(String(a.username_id)) || 0) + v);
    }
  }

  it("per-user dkp_spent equals the sum of their loot awards (exact)", () => {
    const bad = users.users
      .map((u) => ({ u, diff: (Number(u.dkp_spent) || 0) - (spentFromLoot.get(String(u.username_id)) || 0) }))
      .filter((x) => Math.abs(x.diff) > 0.01);
    expect(bad.map((x) => `${x.u.username}:${x.diff.toFixed(2)}`), "users whose dkp_spent != Σ loot").toEqual([]);
  });

  it("per-user dkp_earned stays within ±100 of the raid-attendance sum", () => {
    // Manual adjustments / value edits cause small drift; a large gap means a bad export.
    const bad = users.users
      .map((u) => ({ u, diff: (Number(u.dkp_earned) || 0) - (earnedFromRaids.get(String(u.username_id)) || 0) }))
      .filter((x) => Math.abs(x.diff) > 100);
    expect(bad.map((x) => `${x.u.username}:${x.diff.toFixed(2)}`), "users with earned drift > ±100").toEqual([]);
  });

  it("reports available == earned - spent + adjustments (informational)", () => {
    const mismatches = users.users.filter((u) =>
      Math.abs((Number(u.available_dkp) || 0) - ((Number(u.dkp_earned) || 0) - (Number(u.dkp_spent) || 0) + (Number(u.dkp_adjustments) || 0))) > 0.01);
    // Not asserted: the tracker applies adjustments not always reflected in dkp_adjustments.
    console.log(`  available-dkp identity holds for ${users.users.length - mismatches.length}/${users.users.length} users`);
  });
});

/* ---------------- item coverage ---------------- */

describe("item name coverage (pqdi.cc links)", () => {
  it("≥95% of loot items resolve to an items.json entry", () => {
    const byName = new Set(items.rows.map((r) => String(r.NAME).toLowerCase()));
    const unresolved = loot.loot.filter((l) => !byName.has(String(l.item).toLowerCase()));
    const rate = 1 - unresolved.length / loot.loot.length;
    console.log(`  item coverage: ${(rate * 100).toFixed(1)}% (${unresolved.length} unresolved)`);
    expect(rate, "too many loot items missing from items.json").toBeGreaterThanOrEqual(0.95);
  });
});
