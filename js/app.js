/**
 * app.js — Axiom DKP Metrics: navigation + rendering
 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const esc = Data.escapeHtml;
  const RECENT_LOOT_COUNT = 15;
  const ITEMS_RENDER_CAP = 100;
  const STANDINGS_PAGE_SIZE = 25;

  /* ---------------- sidebar navigation ---------------- */
  function setupNav() {
    const links = document.querySelectorAll(".nav-link");
    links.forEach((link) =>
      link.addEventListener("click", () => {
        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        $(`#${link.dataset.target}`).classList.add("active");
      })
    );
  }

  function setStat(id, text) {
    $(`#${id}`).textContent = text;
  }

  /* ---------------- overview ---------------- */
  function renderOverview(users, loot, items, raids) {
    // Stat cards
    const totalDkpAvailable = users.reduce((s, u) => s + u.activeDkp, 0);
    const topSpender = users.reduce(
      (best, u) => (u.spent > (best?.spent ?? -1) ? u : best),
      null
    );

    // Items awarded in the past 7 days (dates are "YYYY-MM-DD", safe to compare as strings)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const itemsLastWeek = loot.filter((l) => l.date && l.date >= cutoffStr).length;

    // Unique raiders who attended a raid in the past 7 days (from raids.json attendees)
    const recentRaiders = new Set();
    for (const r of raids) {
      if (r.date && r.date >= cutoffStr) {
        for (const name of r.attendees) recentRaiders.add(name);
      }
    }
    const activeRaiders = recentRaiders.size;

    setStat("stat-total-dkp", totalDkpAvailable.toLocaleString());
    setStat("stat-items-awarded", itemsLastWeek.toLocaleString());
    setStat("stat-top-earner", topSpender ? topSpender.username : "–");
    setStat("stat-raiders", activeRaiders.toLocaleString());

    // Recent loot — newest first (dates resolved via raids.json in data.js)
    const dated = loot.filter((l) => l.date).sort((a, b) => b.date.localeCompare(a.date));
    const rows = dated.slice(0, RECENT_LOOT_COUNT);

    $("#recent-loot-table tbody").innerHTML = rows.map((l) => `
      <tr>
        <td>${esc(l.date)}</td>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, items.byName)}</td>
        <td>${l.raid ? esc(l.raid) : "—"}</td>
        <td class="num">${l.dkpSpent}</td>
      </tr>
    `).join("");

    $("#recent-loot-table").hidden = rows.length === 0;
    const status = $("#recent-loot-status");
    status.textContent = dated.length
      ? `Showing ${rows.length} of ${dated.length.toLocaleString()} dated awards (most recent first)`
      : "No dated loot records found.";
  }

  /* ---------------- item database ---------------- */
  function renderItems(items, query = "") {
    const q = query.trim().toLowerCase();
    const matches = q
      ? items.rows.filter((r) => r.NAME.toLowerCase().includes(q))
      : items.rows;

    const shown = matches.slice(0, ITEMS_RENDER_CAP);
    $("#items-table tbody").innerHTML = shown.map((r) => `
      <tr>
        <td class="num">${r.id}</td>
        <td><a href="https://www.pqdi.cc/item/${r.id}" target="_blank" rel="noopener">${esc(r.NAME)}</a></td>
      </tr>
    `).join("");

    $("#item-count").textContent = q
      ? `${matches.length.toLocaleString()} match${matches.length === 1 ? "" : "es"}` +
        (matches.length > ITEMS_RENDER_CAP ? ` · showing first ${ITEMS_RENDER_CAP}` : "")
      : `${items.rows.length.toLocaleString()} items · showing first ${ITEMS_RENDER_CAP}`;
  }

  /* ---------------- raider standings ---------------- */
  let standingsSorted = [];
  let standingsPage = 1;

  function renderStandings(users) {
    standingsSorted = [...users].sort((a, b) => b.activeDkp - a.activeDkp);
    renderStandingsPage(1);
  }

  function renderStandingsPage(page) {
    const totalPages = Math.max(1, Math.ceil(standingsSorted.length / STANDINGS_PAGE_SIZE));
    standingsPage = Math.min(Math.max(1, page), totalPages);
    const start = (standingsPage - 1) * STANDINGS_PAGE_SIZE;
    const rows = standingsSorted.slice(start, start + STANDINGS_PAGE_SIZE);

    $("#standings-table tbody").innerHTML = rows.map((u, i) => {
      const rank = start + i + 1;
      const medal = rank <= 3 ? ` rank-${rank}` : "";
      const dkpCls = u.activeDkp > 0 ? "dkp-positive" : "dkp-zero";
      return `
      <tr>
        <td class="num rank-medal${medal}">${rank}</td>
        <td>${esc(u.username)}</td>
        <td class="num ${dkpCls}">${u.activeDkp.toLocaleString()}</td>
        <td class="num">${u.earned.toLocaleString()}</td>
        <td class="num">${u.spent.toLocaleString()}</td>
      </tr>`;
    }).join("");

    $("#standings-table").hidden = rows.length === 0;
    const status = $("#standings-status");
    status.textContent = `${standingsSorted.length.toLocaleString()} raiders by active DKP · ` +
      (rows.length
        ? `showing ${start + 1}–${start + rows.length.toLocaleString()} (page ${standingsPage} of ${totalPages.toLocaleString()})`
        : "no raiders");

    renderStandingsPager(totalPages);
  }

  function renderStandingsPager(totalPages) {
    const el = $("#standings-pager");
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, standingsPage - 2), hi = Math.min(totalPages - 1, standingsPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    if (totalPages > 1) pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${standingsPage - 1}"${standingsPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === standingsPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${standingsPage + 1}"${standingsPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
  }

  /* ---------------- loot history ---------------- */
  const LOOT_PAGE_SIZE = 25;
  let lootSorted = [];
  let lootPage = 1;

  function renderLoot(loot, items) {
    // Dated first (newest first); undated rows sink to the bottom.
    lootSorted = [...loot].sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    renderLootPage(1, items);
  }

  function renderLootPage(page, items) {
    const totalPages = Math.max(1, Math.ceil(lootSorted.length / LOOT_PAGE_SIZE));
    lootPage = Math.min(Math.max(1, page), totalPages);
    const start = (lootPage - 1) * LOOT_PAGE_SIZE;
    const rows = lootSorted.slice(start, start + LOOT_PAGE_SIZE);

    $("#loot-table tbody").innerHTML = rows.map((l) => `
      <tr>
        <td>${l.date ? esc(l.date) : "—"}</td>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, items.byName)}</td>
        <td class="num">${l.dkpSpent}</td>
      </tr>`).join("");

    $("#loot-table").hidden = rows.length === 0;
    const undated = lootSorted.filter((l) => !l.date).length;
    $("#loot-status").textContent = `${lootSorted.length.toLocaleString()} loot awards · newest first · ` +
      (rows.length
        ? `showing ${start + 1}–${start + rows.length.toLocaleString()} (page ${lootPage} of ${totalPages.toLocaleString()})`
        : "no loot") +
      (undated ? ` · ${undated.toLocaleString()} undated` : "");

    renderLootPager(totalPages);
  }

  function renderLootPager(totalPages) {
    const el = $("#loot-pager");
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, lootPage - 2), hi = Math.min(totalPages - 1, lootPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    if (totalPages > 1) pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${lootPage - 1}"${lootPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === lootPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${lootPage + 1}"${lootPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
  }

  /* ---------------- raid history ---------------- */
  const RAID_PAGE_SIZE = 5;
  let raidsSorted = [];
  let raidPage = 1;

  function renderRaids(raids) {
    raidsSorted = [...raids].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    renderRaidsPage(1);
  }

  function renderRaidsPage(page) {
    const totalPages = Math.max(1, Math.ceil(raidsSorted.length / RAID_PAGE_SIZE));
    raidPage = Math.min(Math.max(1, page), totalPages);
    const start = (raidPage - 1) * RAID_PAGE_SIZE;
    const rows = raidsSorted.slice(start, start + RAID_PAGE_SIZE);

    $("#raids-table tbody").innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.date || "—")}</td>
        <td>${esc(r.name)}</td>
        <td class="num">${r.dkpValue}</td>
        <td class="raid-attendees">${r.attendees.map(esc).join(", ")}</td>
      </tr>`).join("");

    $("#raids-table").hidden = rows.length === 0;
    $("#raids-status").textContent = `${raidsSorted.length.toLocaleString()} raids · newest first · ` +
      (rows.length ? `showing ${start + 1}–${start + rows.length.toLocaleString()} (page ${raidPage} of ${totalPages.toLocaleString()})` : "no raids");

    renderRaidsPager(totalPages);
  }

  function renderRaidsPager(totalPages) {
    const el = $("#raids-pager");
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, raidPage - 2), hi = Math.min(totalPages - 1, raidPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    if (totalPages > 1) pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${raidPage - 1}"${raidPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === raidPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${raidPage + 1}"${raidPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
  }

  /* ---------------- init ---------------- */
  async function init() {
    setupNav();

    try {
      const [items, loot, users, raids] = await Promise.all([
        Data.loadItems(),
        Data.loadLoot(),
        Data.loadUsers(),
        Data.loadRaids(),
      ]);

      renderOverview(users, loot, items, raids);
      renderStandings(users);
      renderItems(items);
      renderLoot(loot, items);
      renderRaids(raids);

      // Paginations (delegated — pager buttons are re-created each render)
      $("#raids-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderRaidsPage(Number(btn.dataset.page));
      });
      $("#standings-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderStandingsPage(Number(btn.dataset.page));
      });
      $("#loot-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderLootPage(Number(btn.dataset.page), items);
      });

      // Debounced item search
      let t;
      $("#item-search").addEventListener("input", (e) => {
        clearTimeout(t);
        t = setTimeout(() => renderItems(items, e.target.value), 200);
      });
    } catch (err) {
      console.error(err);
      document.querySelectorAll(".panel-status").forEach((el) => {
        el.textContent = `Failed to load data: ${err.message}`;
        el.classList.add("error");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
