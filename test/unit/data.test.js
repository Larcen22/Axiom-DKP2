/**
 * Unit tests for js/data.js — the data layer.
 *
 * Strategy: load data.js via CommonJS require (see export guard at its bottom),
 * stub global `fetch` with in-memory JSON fixtures, and stub global `Papa`
 * with a wrapper around the real papaparse package (same parser as production,
 * minus the browser-only `download:` mode).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const realPapa = req("papaparse");

/* ---------------- fixtures ---------------- */

const JSON_FIXTURES = {
  "items.json": {
    table: "items",
    rows: [
      { id: 1, NAME: "Cloth Cap" },
      { id: 2, NAME: "Iron Sword" },
      { id: 3 }, // missing NAME -> skipped
      { NAME: "No Id Row" }, // missing id -> skipped
    ],
  },
  "raids.json": {
    raids: [
      {
        raid_id: "r1",
        date: "2026-08-01T19:30:00Z",
        raid_name: "Raid One",
        raid_dkp_value: 50,
        attendees: [
          { username_id: "u1", character_name: "CharA" },
          { username_id: "", character_name: "NoId" }, // falsy id -> filtered from attendeeUserIds
          { character_name: "NoName" }, // no id, but has a name -> stays in attendees
        ],
      },
      { raid_id: "r2", date: null, raid_name: "" }, // no date, empty name
    ],
  },
  "loot.json": {
    loot: [
      { item: "Cloth Cap", character_name: "CharA", username_id: "u1", raid_id: "r1", item_dkp_value: 25, date: "2026-07-30T14:22:05.123456+00:00" }, // own (full-timestamp) date wins, normalized
      { item: "Iron Sword", character_name: "CharB", username_id: "u1", raid_id: "r1", item_dkp_value: "40" }, // no date -> raid date; string value coerced
      { item: "Mystery Item", character_name: "CharC", username_id: "u2", raid_id: "nope", item_dkp_value: 10 }, // unknown raid -> nulls
      { item: "Freebie", character_name: "CharD", username_id: "u2", raid_id: "r1" }, // missing dkp value -> 0
    ],
  },
  "users.json": {
    users: [
      { username: "Alice", username_id: "u1", available_dkp: "100", dkp_earned: 300, dkp_spent: 200 },
      { username: "Bob", username_id: "u2" }, // missing numbers -> 0
    ],
  },
};

const CSV_FIXTURES = {
  "roster-export.csv": [
    "MemberName,CharacterName,Class,Level,Race,Main/Alt,Rank,AvailableDKP,EarnedDKP,SpentDKP,ApplicationDate,MembershipDate",
    'Alice,CharA,Beastlord,56,Vah Shir,main,Officer,100,300,200,2026-01-05T00:00:00,2025-12-01T00:00:00',
    "Bob,CharB,Necromancer,40,Tutha,alt,,0,50,50,,", // empty dates -> ""
  ].join("\n"),
};

/* ---------------- helpers ---------------- */

function makeFetchStub(files = JSON_FIXTURES) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const key = String(url).split("/").pop();
    if (!(key in files)) throw new Error(`no JSON fixture for ${url}`);
    return new Response(JSON.stringify(files[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  fn.calls = calls;
  return fn;
}

function makePapaStub(files = CSV_FIXTURES) {
  return {
    parse(url, opts) {
      const key = String(url).split("/").pop();
      if (!(key in files)) throw new Error(`no CSV fixture for ${url}`);
      const res = realPapa.parse(files[key], {
        header: true,
        skipEmptyLines: true,
        trimHeaders: true,
        transform: opts.transform,
      });
      if (res.errors.length && res.data.length === 0) return opts.error(new Error("CSV parse failed"));
      opts.complete(res);
    },
  };
}

/** Fresh module instance per call (data.js caches the raids fetch promise). */
function loadData() {
  const p = req.resolve("../../js/data.js");
  delete req.cache[p];
  return req(p);
}

beforeEach(() => {
  vi.stubGlobal("fetch", makeFetchStub());
  vi.stubGlobal("Papa", makePapaStub());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------- items ---------------- */

describe("loadItems", () => {
  it("builds byId / byName indexes and skips malformed rows", async () => {
    const Data = loadData();
    const { byId, byName, rows } = await Data.loadItems();
    expect(rows).toHaveLength(2); // two bad rows skipped
    expect(byId.get(1)).toBe("Cloth Cap");
    expect(byName.get("cloth cap")).toBe(1); // lowercase key
    expect(byName.has("no id row")).toBe(false);
  });

  it("throws on unexpected structure", async () => {
    vi.stubGlobal("fetch", makeFetchStub({ "items.json": { table: "wrong", rows: [] } }));
    const Data = loadData();
    await expect(Data.loadItems()).rejects.toThrow(/unexpected structure/);
  });

  it("excludes ambiguous names (multiple ids) from byName -> plain text link", async () => {
    vi.stubGlobal("fetch", makeFetchStub({
      "items.json": { table: "items", rows: [
        { id: 1, NAME: "Mark of Shadows" },
        { id: 2, NAME: "mark of shadows" }, // same name (case-insensitive), different id
        { id: 3, NAME: "Cloth Cap" },
      ]},
    }));
    const Data = loadData();
    const { byName, ambiguous } = await Data.loadItems();
    expect(byName.has("mark of shadows")).toBe(false);
    expect(ambiguous.has("mark of shadows")).toBe(true);
    expect(byName.get("cloth cap")).toBe(3); // unambiguous names unaffected
    expect(Data.itemLink("Mark of Shadows", byName)).toBe("Mark of Shadows"); // no link
  });

  it("treats duplicate rows with the same id as unambiguous", async () => {
    vi.stubGlobal("fetch", makeFetchStub({
      "items.json": { table: "items", rows: [
        { id: 1, NAME: "Cloth Cap" },
        { id: 1, NAME: "cloth cap" }, // same id -> still one entry
      ]},
    }));
    const Data = loadData();
    const { byName, ambiguous } = await Data.loadItems();
    expect(byName.get("cloth cap")).toBe(1);
    expect(ambiguous.size).toBe(0);
  });
});

/* ---------------- itemLink / escapeHtml ---------------- */

describe("itemLink", () => {
  it("links known items to pqdi.cc with escaped label", async () => {
    const Data = loadData();
    const { byName } = await Data.loadItems();
    expect(Data.itemLink("Cloth Cap", byName)).toBe(
      '<a href="https://www.pqdi.cc/item/1" target="_blank" rel="noopener">Cloth Cap</a>'
    );
  });

  it("falls back to escaped plain text for unknown items", () => {
    const Data = loadData();
    expect(Data.itemLink("Unknown <Item>", new Map())).toBe("Unknown &lt;Item&gt;");
  });

  it("escapes the label even when linked (XSS safety)", async () => {
    const Data = loadData();
    const byName = new Map([["evil <b>\"x\"", 9]]);
    expect(Data.itemLink('Evil <B>"X"', byName)).toContain("&lt;B&gt;&quot;X&quot;");
    expect(Data.itemLink('Evil <B>"X"', byName)).not.toContain("<b>");
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-sensitive characters", () => {
    const Data = loadData();
    expect(Data.escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("coerces non-strings via String()", () => {
    const Data = loadData();
    expect(Data.escapeHtml(42)).toBe("42");
    expect(Data.escapeHtml(null)).toBe("null");
  });
});

/* ---------------- raids ---------------- */

describe("loadRaidInfo / loadRaids", () => {
  it("truncates dates to YYYY-MM-DD and tolerates missing values", async () => {
    const Data = loadData();
    const info = await Data.loadRaidInfo();
    expect(info.get("r1")).toEqual({ date: "2026-08-01", name: "Raid One" });
    expect(info.get("r2")).toEqual({ date: null, name: "" });
  });

  it("maps attendees and filters falsy ids/names", async () => {
    const Data = loadData();
    const raids = await Data.loadRaids();
    expect(raids).toHaveLength(2);
    expect(raids[0]).toMatchObject({ date: "2026-08-01", name: "Raid One", dkpValue: 50 });
    expect(raids[0].attendees).toEqual(["CharA", "NoId", "NoName"]); // only falsy names dropped
    expect(raids[0].attendeeUserIds).toEqual(["u1"]); // missing/empty ids filtered
    expect(raids[1]).toMatchObject({ date: null, name: "", dkpValue: 0, attendees: [], attendeeUserIds: [] });
  });

  it("shares one fetch between loadRaidInfo and loadRaids", async () => {
    const Data = loadData();
    await Promise.all([Data.loadRaidInfo(), Data.loadRaids()]);
    expect(globalThis.fetch.calls.filter((u) => u.endsWith("raids.json"))).toHaveLength(1);
  });

  it("does not cache failures — a retry re-fetches", async () => {
    let failNext = true;
    vi.stubGlobal(
      "fetch",
      async (url) => {
        if (failNext && String(url).endsWith("raids.json")) {
          failNext = false;
          return new Response("{}", { status: 500 });
        }
        return makeFetchStub()(url);
      }
    );
    const Data = loadData();
    await expect(Data.loadRaids()).rejects.toThrow(/HTTP 500/);
    await new Promise((r) => setTimeout(r, 0)); // let the cache-reset microtask run
    const raids = await Data.loadRaids();
    expect(raids).toHaveLength(2);
  });

  it("throws a descriptive error on non-OK responses", async () => {
    vi.stubGlobal("fetch", makeFetchStub({ "users.json": null })); // replaced below
    vi.stubGlobal(
      "fetch",
      async () => new Response("{}", { status: 503 })
    );
    const Data = loadData();
    await expect(Data.loadUsers()).rejects.toThrow(/Failed to fetch users\.json \(HTTP 503\)/);
  });
});

/* ---------------- loot ---------------- */

describe("loadLoot", () => {
  it("prefers the loot's own date, falls back to raid date, else null", async () => {
    const Data = loadData();
    const loot = await Data.loadLoot();
    expect(loot[0].date).toBe("2026-07-30"); // own date wins over raid r1 (2026-08-01); full timestamp normalized to YYYY-MM-DD
    expect(loot[1]).toMatchObject({ date: "2026-08-01", raid: "Raid One" }); // resolved via raid_id
    expect(loot[2]).toMatchObject({ date: null, raid: null }); // unknown raid_id
  });

  it("coerces dkpSpent to number with 0 fallback", async () => {
    const Data = loadData();
    const loot = await Data.loadLoot();
    expect(loot[1].dkpSpent).toBe(40); // "40" -> 40
    expect(loot[3].dkpSpent).toBe(0); // missing -> 0
  });

  it("exposes the owner username_id as user (member-level grouping)", async () => {
    const Data = loadData();
    const loot = await Data.loadLoot();
    expect(loot[0].user).toBe("u1");
    expect(loot[2].user).toBe("u2");
  });

  it("throws on unexpected structure", async () => {
    vi.stubGlobal("fetch", makeFetchStub({ ...JSON_FIXTURES, "loot.json": { wrong: true } }));
    const Data = loadData();
    await expect(Data.loadLoot()).rejects.toThrow(/expected \{ loot/);
  });
});

/* ---------------- isoDate ---------------- */

describe("isoDate", () => {
  it("normalizes full timestamps to YYYY-MM-DD and passes clean dates through", () => {
    const Data = loadData();
    expect(Data.isoDate("2026-07-30")).toBe("2026-07-30");
    expect(Data.isoDate("2024-12-10T20:42:05.793672+00:00")).toBe("2024-12-10"); // stray shape from loot.json
    expect(Data.isoDate("2024-10-25 23:43:34")).toBe("2024-10-25"); // space-separated (roster CSV)
    expect(Data.isoDate(null)).toBeNull();
    expect(Data.isoDate("")).toBeNull();
  });

  it("returns null for unparseable junk (never leaks into a date cell)", () => {
    const Data = loadData();
    expect(Data.isoDate("N/A")).toBeNull();
    expect(Data.isoDate("unknown")).toBeNull();
    expect(Data.isoDate(12345)).toBeNull(); // numeric junk, not a date
  });
});

/* ---------------- users ---------------- */

describe("loadUsers", () => {
  it("coerces numeric strings and defaults missing values to 0", async () => {
    const Data = loadData();
    const users = await Data.loadUsers();
    expect(users[0]).toEqual({ username: "Alice", usernameId: "u1", activeDkp: 100, earned: 300, spent: 200 });
    expect(users[1]).toEqual({ username: "Bob", usernameId: "u2", activeDkp: 0, earned: 0, spent: 0 });
  });
});

/* ---------------- roster (CSV) ---------------- */

describe("loadRoster", () => {
  it("maps CSV columns including Main/Alt and truncates dates", async () => {
    const Data = loadData();
    const rows = await Data.loadRoster();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      member: "Alice",
      character: "CharA",
      cls: "Beastlord",
      level: 56,
      race: "Vah Shir",
      mainAlt: "main",
      rank: "Officer",
      availableDkp: 100,
      earnedDkp: 300,
      spentDkp: 200,
      applied: "2026-01-05",
      memberSince: "2025-12-01",
    });
    expect(rows[1].applied).toBe(""); // empty ApplicationDate -> ""
    expect(rows[1].rank).toBe("");
  });

  it("rejects when the CSV fails to parse entirely", async () => {
    vi.stubGlobal(
      "Papa",
      { parse(_url, opts) { opts.error(new Error("network down")); } }
    );
    const Data = loadData();
    await expect(Data.loadRoster()).rejects.toThrow(/Failed to fetch\/parse roster-export\.csv/);
  });
});
