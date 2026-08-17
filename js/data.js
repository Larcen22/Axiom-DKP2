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
   * @returns {Promise<{
   *   byId:   Map<number, string>,       // id -> NAME
   *   byName: Map<string, number>,       // NAME (lowercase) -> id  (for pqdi.cc links)
   *   rows:   Array<{ id: number, NAME: string }>
   * }>}
   */
  async function loadItems() {
    const data = await fetchJson("items.json");
    if (data.table !== "items" || !Array.isArray(data.rows)) {
      throw new Error('items.json has unexpected structure: expected { table: "items", rows: [...] }');
    }

    const byId = new Map();
    const byName = new Map();
    const rows = [];
    for (const row of data.rows) {
      if (typeof row.id !== "number" || typeof row.NAME !== "string") continue;
      byId.set(row.id, row.NAME);
      byName.set(row.NAME.toLowerCase(), row.id);
      rows.push(row);
    }
    return { byId, byName, rows };
  }

  /**
   * Build an anchor for a loot item name using the items.json id:
   *   <a href="https://www.pqdi.cc/item/1001">Cloth Cap</a>
   * Falls back to plain text if the name isn't in the database.
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

  /** @returns {Promise<Map<string, {date: string|null, name: string}>>} raid_id -> {date, name} */
  async function loadRaidInfo() {
    const data = await fetchJson("raids.json");
    if (!Array.isArray(data.raids)) throw new Error("raids.json: expected { raids: [...] }");
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
   *   each row: { date, player, item, raid, dkpSpent }
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
    const data = await fetchJson("raids.json");
    if (!Array.isArray(data.raids)) throw new Error("raids.json: expected { raids: [...] }");
    return data.raids.map((r) => ({
      date: r.date ? String(r.date).slice(0, 10) : null,
      name: r.raid_name || "",
      dkpValue: Number(r.raid_dkp_value) || 0,
      attendees: (r.attendees || []).map((a) => a.character_name).filter(Boolean),
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
      activeDkp: Number(u.available_dkp) || 0,
      earned: Number(u.dkp_earned) || 0,
      spent: Number(u.dkp_spent) || 0,
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
    loadCsv,
    itemLink,
    escapeHtml,
  };
})();
