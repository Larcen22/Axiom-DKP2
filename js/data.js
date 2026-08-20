/**
 * data.js — Axiom-DKP2 data layer
 * ------------------------------------------------------------------
 * Loads local exports (JSON + CSV) entirely client-side:
 *   - items.json        : item database   ({ table, rows: [{ id, NAME }] })
 *   - loot.json         : loot awards     ({ loot: [{ item, character_name, item_dkp_value, date?, raid_id }] })
 *   - raids.json        : raid log        ({ raids: [{ raid_id, date, raid_name }] })
 *   - users.json        : raider accounts ({ users: [{ username, available_dkp, dkp_earned, dkp_spent }] })
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

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
    return res.json();
  }

  /* ---------------- items.json ---------------- */

  /**
   * Load the item database and build lookup indexes.
   * Names that map to more than one id are AMBIGUOUS and excluded from byName
   * (itemLink then renders them as plain text rather than guessing an expansion).
   * @returns {Promise<{
   *   byId:       Map<number, string>,       // id -> NAME
   *   byName:     Map<string, number>,       // NAME (lowercase) -> id  (for pqdi.cc links; unambiguous only)
   *   ambiguous:  Set<string>,               // lowercase names with >1 id (no link)
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
      if (!ambiguous.has(key)) {
        const existing = byName.get(key);
        if (existing === undefined) byName.set(key, row.id);
        else if (existing !== row.id) { byName.delete(key); ambiguous.add(key); }
      }
      rows.push(row);
    }
    return { byId, byName, ambiguous, rows };
  }

  /**
   * Build an anchor for a loot item name using the items.json id:
   *   <a href="https://www.pqdi.cc/item/1001">Cloth Cap</a>
   * Falls back to plain text if the name isn't in the database or is ambiguous
   * (multiple ids — see loadItems).
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
      if (raid.raid_id) map.set(raid.raid_id, {
        date: raid.date ? String(raid.date).slice(0, 10) : null,
        name: raid.raid_name || "",
      });
    }
    return map;
  }

  /* ---------------- loot.json ---------------- */

  /**
   * Load loot awards, resolving missing dates via raid_id → raids.json.
   * @returns {Promise<Array<object>>}
   *   each row: { date, player, user, item, raid, dkpSpent }  (user = owner username_id or null)
   *   (date is "YYYY-MM-DD" or null when unresolvable; raid is the raid name or null)
   */
  async function loadLoot() {
    const [data, raidInfo] = await Promise.all([fetchJson("loot.json"), loadRaidInfo()]);
    if (!Array.isArray(data.loot)) throw new Error("loot.json: expected { loot: [...] }");

    return data.loot.map((l) => {
      const raid = raidInfo.get(l.raid_id) || null;
      return {
        // Prefer the loot's own date; fall back to the raid's date.
        date: (l.date || (raid && raid.date) || null),
        player: l.character_name,
        user: l.username_id || null, // owner username_id (for member-level grouping)
        item: l.item,
        raid: (raid && raid.name) || null,
        dkpSpent: Number(l.item_dkp_value) || 0,
      };
    });
  }

  /* ---------------- raids.json ---------------- */

  /**
   * Load the full raid log.
   * @returns {Promise<Array<{ date: string|null, name: string, dkpValue: number, attendees: string[] }>>}
   */
  async function loadRaids() {
    const data = await fetchRaids();
    return data.raids.map((r) => ({
      date: r.date ? String(r.date).slice(0, 10) : null,
      name: r.raid_name || "",
      dkpValue: Number(r.raid_dkp_value) || 0,
      attendees: (r.attendees || []).map((a) => a.character_name).filter(Boolean),
      attendeeUserIds: (r.attendees || []).map((a) => a.username_id).filter(Boolean),
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
      usernameId: u.username_id,
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
      applied: r.ApplicationDate ? String(r.ApplicationDate).slice(0, 10) : "",
      memberSince: r.MembershipDate ? String(r.MembershipDate).slice(0, 10) : "",
    }));
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
    loadItems,
    loadLoot,
    loadRaids,
    loadRaidInfo,
    loadUsers,
    loadRoster,
    loadCsv,
    itemLink,
    escapeHtml,
  };
})();

// Test hook — expose Data when loaded via CommonJS require() (Vitest / Node scripts).
if (typeof module !== "undefined" && module.exports) {
  module.exports = Data;
}
