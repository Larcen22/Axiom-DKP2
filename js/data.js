/**
 * data.js — Axiom-DKP2 data layer
 * ------------------------------------------------------------------
 * Loads local exports (JSON + CSV) entirely client-side:
 *   - items.json        : item database   ({ table, rows: [{ id, NAME }] })
 *   - loot.json         : loot awards     ({ loot: [{ item, character_name, item_dkp_value, date?, raid_id }] })
 *   - raids.json        : raid log        ({ raids: [{ raid_id, date, raid_name }] })
 *   - users.json        : raider accounts ({ users: [{ username, available_dkp, dkp_earned, dkp_spent }] })
 *   - transactions.json : DKP adjustments ({ transactions: [...] }) — OPTIONAL file
 *   - roster-export.csv : roster metrics  (PapaParse)
 *
 * Loot dates: many loot entries have no `date`; resolve them via
 *   loot.raid_id → raids.json raid.date
 *
 * NOTE: serve over HTTP (fetch is blocked on file://):
 *   npx serve .  or  python3 -m http.server 8000
 */

const Data = (() => {
  "use strict";

  // Freshness tracking: sw.js tags same-origin responses X-Data-Freshness —
  // "fresh" when served from the network, "stale" when served from the offline
  // cache. The app surfaces this (footer indicator + banner) so officers always
  // know whether they're looking at live data or a cached copy.
  const staleFiles = [];

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
    if (res.headers.get("X-Data-Freshness") === "stale") staleFiles.push(url);
    return res.json();
  }

  /* ---------------- items.json ---------------- */

  /**
   * Load the item database and build lookup indexes.
   * Names that map to more than one id are AMBIGUOUS (pqdi.cc lists the same
   * name under several ids — duplicate imports / variants). byName keeps the
   * LARGEST id deterministically: every candidate is a pqdi.cc page for an item
   * bearing that exact name, and in practice the larger (newer) pqdi.cc entry
   * carries the more complete data (owner decision 2026-08).
   * @returns {Promise<{
   *   byId:       Map<number, string>,       // id -> NAME
   *   byName:     Map<string, number>,       // NAME (lowercase) -> id  (for pqdi.cc links; largest id when ambiguous)
   *   ambiguous:  Set<string>,               // lowercase names with >1 id (still linked — to the largest id)
   *   rows:       Array<{ id: number, NAME: string }>
   * }>}
   */
  async function loadItems() {
    const data = await fetchJson("items.json");
    if (data.table !== "items" || !Array.isArray(data.rows)) {
      throw new Error('items.json has unexpected structure: expected { table: "items", rows: [...] }');
    }

    const byId = new Map();
    const byName = new Map();
    const ambiguous = new Set();
    const rows = [];
    for (const row of data.rows) {
      if (typeof row.id !== "number" || typeof row.NAME !== "string") continue;
      byId.set(row.id, row.NAME);
      const key = row.NAME.toLowerCase();
      const existing = byName.get(key);
      if (existing === undefined) {
        byName.set(key, row.id);
      } else if (existing !== row.id) {
        ambiguous.add(key);
        if (row.id > existing) byName.set(key, row.id); // deterministic pick: largest id
      }
      rows.push(row);
    }
    return { byId, byName, ambiguous, rows };
  }

  /**
   * Build an anchor for a loot item name using the items.json id:
   *   <a href="https://www.pqdi.cc/item/1001">Cloth Cap</a>
   * Falls back to plain text only when the name isn't in the database.
   * Ambiguous names (multiple ids) link to the largest id — see loadItems().
   * @param {string} itemName
   * @param {Map<string, number>} byName - from loadItems()
   * @returns {string} safe HTML (name must already be trusted/local data)
   */
  function itemLink(itemName, byName) {
    const id = byName.get(String(itemName).toLowerCase());
    if (id == null) return escapeHtml(itemName);
    return `<a href="https://www.pqdi.cc/item/${id}" target="_blank" rel="noopener">${escapeHtml(itemName)}</a>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------------- raids.json ---------------- */

  // Shared cache: loadRaidInfo() (via loadLoot) and loadRaids() both need this file;
  // without it the ~8 MB JSON is fetched + parsed twice per page load.
  let raidsPromise = null;
  function fetchRaids() {
    if (!raidsPromise) {
      raidsPromise = (async () => {
        const data = await fetchJson("raids.json");
        if (!Array.isArray(data.raids)) throw new Error("raids.json: expected { raids: [...] }");
        return data;
      })();
      // Don't cache failures — a future retry can re-fetch.
      raidsPromise.catch(() => { raidsPromise = null; });
    }
    return raidsPromise;
  }

  /** @returns {Promise<Map<string, {date: string|null, name: string}>>} raid_id -> {date, name} */
  async function loadRaidInfo() {
    const data = await fetchRaids();
    const map = new Map();
    for (const raid of data.raids) {
      // Join keys are normalized to strings at the boundary so cross-file Map/Set
      // joins can't silently break on string/number type drift between exports.
      if (raid.raid_id) map.set(String(raid.raid_id), {
        date: isoDate(raid.date),
        name: raid.raid_name || "",
      });
    }
    return map;
  }

  /* ---------------- loot.json ---------------- */

  /**
   * Load loot awards, resolving missing dates via raid_id → raids.json.
   * @returns {Promise<Array<object>>}
   *   each row: { date, player, user, item, raid, raidId, dkpSpent }  (user = owner username_id or null)
   *   (date is "YYYY-MM-DD" or null when unresolvable; raid is the raid name or null)
   */
  async function loadLoot() {
    const [data, raidInfo] = await Promise.all([fetchJson("loot.json"), loadRaidInfo()]);
    if (!Array.isArray(data.loot)) throw new Error("loot.json: expected { loot: [...] }");

    return data.loot.map((l) => {
      const raid = l.raid_id ? raidInfo.get(String(l.raid_id)) || null : null;
      return {
        // Prefer the loot's own date; fall back to the raid's date. Both normalized to YYYY-MM-DD.
        date: isoDate(l.date || (raid && raid.date)),
        player: l.character_name,
        user: l.username_id ? String(l.username_id) : null, // owner username_id (for member-level grouping)
        item: l.item,
        raid: (raid && raid.name) || null,
        raidId: l.raid_id ? String(l.raid_id) : null, // exact join key to raids.json (names repeat over time)
        dkpSpent: Number(l.item_dkp_value) || 0,
      };
    });
  }

  /**
   * Normalize any exported date value to "YYYY-MM-DD" (or null when empty/unparseable).
   * Exports occasionally carry full timestamps ("2024-12-10T20:42:05.793672+00:00",
   * "2024-10-25 23:43:34"); the UI only ever shows the date part.
   * Anything that doesn't start with YYYY-MM-DD is treated as missing (null),
   * so junk values can never leak into a date cell.
   */
  function isoDate(v) {
    const s = v == null ? "" : String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    // Calendar validation: the shape check alone would accept "2024-13-99".
    // ISO-string parsing rejects out-of-range components (month 13, Feb 30, …).
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : s.slice(0, 10);
  }

  /* ---------------- raids.json ---------------- */

  /**
   * Load the full raid log.
   * @returns {Promise<Array<{ id: string|null, date: string|null, name: string,
   *   dkpValue: number, attendees: string[], attendeeUserIds: string[] }>>}
   */
  async function loadRaids() {
    const data = await fetchRaids();
    return data.raids.map((r) => ({
      id: r.raid_id ? String(r.raid_id) : null, // normalized to string for stable cross-file joins
      date: isoDate(r.date),
      name: r.raid_name || "",
      dkpValue: Number(r.raid_dkp_value) || 0,
      // Attendee entries are { username_id, character_name } objects; legacy exports may
      // carry plain strings — accept both so old data can't be silently dropped.
      attendees: (r.attendees || []).map((a) => (typeof a === "string" ? a : a && a.character_name)).filter(Boolean),
      attendeeUserIds: (r.attendees || [])
        .map((a) => (a && typeof a === "object" && a.username_id ? String(a.username_id) : null))
        .filter(Boolean),
    }));
  }

  /* ---------------- users.json ---------------- */

  /**
   * @returns {Promise<Array<object>>}
   *   each row: { username, activeDkp, earned, spent }
   */
  async function loadUsers() {
    const data = await fetchJson("users.json");
    if (!Array.isArray(data.users)) throw new Error("users.json: expected { users: [...] }");
    return data.users.map((u) => ({
      username: u.username,
      usernameId: u.username_id ? String(u.username_id) : null,
      activeDkp: Number(u.available_dkp) || 0,
      earned: Number(u.dkp_earned) || 0,
      spent: Number(u.dkp_spent) || 0,
    }));
  }

  /* ---------------- roster-export.csv ---------------- */

  /**
   * Load the roster export (one row per character).
   * @returns {Promise<Array<object>>}
   *   each row: { member, character, cls, level, race, mainAlt, rank,
   *               availableDkp, earnedDkp, spentDkp, applied, memberSince }
   */
  async function loadRoster() {
    const { data } = await loadCsv("roster-export.csv");
    return data.map((r) => ({
      member: r.MemberName || "",
      character: r.CharacterName || "",
      cls: r.Class || "",
      level: Number(r.Level) || 0,
      race: r.Race || "",
      mainAlt: r["Main/Alt"] || "",
      rank: r.Rank || "",
      availableDkp: Number(r.AvailableDKP) || 0,
      earnedDkp: Number(r.EarnedDKP) || 0,
      spentDkp: Number(r.SpentDKP) || 0,
      applied: isoDate(r.ApplicationDate) || "",
      memberSince: isoDate(r.MembershipDate) || "",
    }));
  }

  /* ---------------- transactions.json (optional) ---------------- */

  /**
   * Load account-level DKP adjustment transactions (achievement bonuses,
   * recruit bonuses, manual adjustments). The file is OPTIONAL: a missing or
   * unreadable export resolves to [] so the rest of the app still works
   * (e.g. when the file isn't in the repo). Malformed exports
   * are caught by the integrity tests locally.
   * @returns {Promise<Array<{ id: string|null, usernameId: string|null,
   *   username: string, type: string, amount: number, reason: string,
   *   date: string|null }>>}
   */
  async function loadTransactions() {
    try {
      const data = await fetchJson("transactions.json");
      if (!Array.isArray(data.transactions)) throw new Error("transactions.json: expected { transactions: [...] }");
      return data.transactions.map((t) => ({
        id: t.transaction_id ? String(t.transaction_id) : null,
        usernameId: t.username_id ? String(t.username_id) : null,
        username: t.username || "",
        type: t.type || "",
        amount: Number(t.transaction_amount) || 0,
        reason: t.reason || "",
        date: isoDate(t.date), // full ISO timestamps normalize to YYYY-MM-DD
      }));
    } catch (err) {
      console.warn("transactions.json unavailable, continuing without it:", err.message);
      return [];
    }
  }

  /* ---------------- generic CSV (PapaParse) ---------------- */

  /**
   * Fetch and parse a generic CSV file (e.g. roster-export.csv).
   * @param {string} url
   * @returns {Promise<{ data: Array<Object>, meta: Object, headers: string[] }>}
   */
  function loadCsv(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,            // PapaParse handles the fetch
        header: true,              // first row = column names
        skipEmptyLines: true,
        trimHeaders: true,
        transform: (value) =>
          value !== "" && Number.isFinite(Number(value)) ? Number(value) : value,
        complete: (result) => {
          if (result.errors.length && result.data.length === 0) {
            reject(new Error(`CSV parse failed for ${url}: ${result.errors[0].message}`));
            return;
          }
          resolve({ data: result.data, meta: result.meta, headers: result.meta.fields || [] });
        },
        error: (err) => reject(new Error(`Failed to fetch/parse ${url}: ${err.message}`)),
      });
    });
  }

  return {
    staleFiles,
    loadItems,
    loadLoot,
    loadRaids,
    loadRaidInfo,
    loadUsers,
    loadTransactions,
    loadRoster,
    loadCsv,
    itemLink,
    escapeHtml,
    isoDate,
  };
})();

// Test hook — expose Data when loaded via CommonJS require() (Vitest / Node scripts).
if (typeof module !== "undefined" && module.exports) {
  module.exports = Data;
}
