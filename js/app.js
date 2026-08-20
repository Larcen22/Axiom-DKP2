/**
 * app.js — Axiom DKP Metrics: navigation + rendering
 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const setStat = (id, value) => {
    const el = $(`#${id}`);
    if (el) el.textContent = value;
  };
  const esc = Data.escapeHtml;
  const ITEMS_RENDER_CAP = 100;
  const RECENT_LOOT_PAGE_SIZE = 25;
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

  function renderPager(containerId, currentPage, totalPages) {
    const el = $(`#${containerId}`);
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, currentPage - 2), hi = Math.min(totalPages - 1, currentPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    if (totalPages > 1) pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${currentPage - 1}"${currentPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === currentPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${currentPage + 1}"${currentPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
  }

  /* ---------------- overview ---------------- */
  let recentLootAll = [];
  let recentLootPage = 1;

  function renderOverview(users, loot, items, raids, roster) {
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
    const weekLoot = loot.filter((l) => l.date && l.date >= cutoffStr);
    const itemsLastWeek = weekLoot.length;

    // Avg DKP spent per unique player (character) in the past 7 days.
    const totalSpentWeek = weekLoot.reduce((s, l) => s + l.dkpSpent, 0);
    const spendersWeek = new Set(weekLoot.map((l) => l.player)).size;
    const avgSpentWeek = spendersWeek ? totalSpentWeek / spendersWeek : null;

    // Unique members who attended a raid in the past 7 days (from raids.json attendees).
    // Counted by owner (username_id), so a member on multiple characters counts once.
    const recentRaiders = new Set();
    for (const r of raids) {
      if (r.date && r.date >= cutoffStr) {
        for (const uid of r.attendeeUserIds) recentRaiders.add(uid);
      }
    }
    const activeRaiders = recentRaiders.size;

    // Average raid size over the past 30 days (attendees per raid). Dates are "YYYY-MM-DD".
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff30Str = `${cutoff30.getFullYear()}-${String(cutoff30.getMonth() + 1).padStart(2, "0")}-${String(cutoff30.getDate()).padStart(2, "0")}`;
    let recentRaidCount = 0, recentRaidAttendees = 0;
    for (const r of raids) {
      if (r.date && r.date >= cutoff30Str) {
        recentRaidCount++;
        recentRaidAttendees += r.attendees.length;
      }
    }
    const avgRaidSize = recentRaidCount ? recentRaidAttendees / recentRaidCount : null;

    // New members: unique roster members whose application date falls in the past 30 days.
    // (A member on multiple characters counts once.)
    const newMembers = new Set(
      roster.filter((r) => r.applied && r.applied >= cutoff30Str).map((r) => r.member)
    ).size;

    setStat("stat-total-dkp", totalDkpAvailable.toLocaleString());
    setStat("stat-items-awarded", itemsLastWeek.toLocaleString());
    setStat("stat-avg-spent-week", avgSpentWeek != null
      ? Math.round(avgSpentWeek).toLocaleString()
      : "–");
    setStat("stat-top-earner", topSpender ? topSpender.username : "–");
    setStat("stat-raiders", activeRaiders.toLocaleString());
    setStat("stat-avg-raid-size", avgRaidSize != null
      ? Math.round(avgRaidSize).toLocaleString()
      : "–");
    setStat("stat-new-members", newMembers.toLocaleString());

    // Recent loot — all awards in the past 7 days, newest first (dates resolved via raids.json in data.js)
    recentLootAll = loot.filter((l) => l.date && l.date >= cutoffStr)
      .sort((a, b) => b.date.localeCompare(a.date));
    renderRecentLootPage(1, items);
  }

  function renderRecentLootPage(page, items) {
    const totalPages = Math.max(1, Math.ceil(recentLootAll.length / RECENT_LOOT_PAGE_SIZE));
    recentLootPage = Math.min(Math.max(1, page), totalPages);
    const start = (recentLootPage - 1) * RECENT_LOOT_PAGE_SIZE;
    const rows = recentLootAll.slice(start, start + RECENT_LOOT_PAGE_SIZE);

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
    $("#recent-loot-status").textContent = recentLootAll.length
      ? `Showing ${start + 1}–${start + rows.length.toLocaleString()} of ${recentLootAll.length.toLocaleString()} awards from the past 7 days (page ${recentLootPage} of ${totalPages.toLocaleString()})`
      : "No loot awards in the past 7 days.";

    renderRecentLootPager(totalPages);
  }

  function renderRecentLootPager(totalPages) {
    const el = $("#recent-loot-pager");
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, recentLootPage - 2), hi = Math.min(totalPages - 1, recentLootPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${recentLootPage - 1}"${recentLootPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === recentLootPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${recentLootPage + 1}"${recentLootPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
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
  let lootFiltered = [];
  let lootSearch = "";
  let lootPage = 1;

  function renderLoot(loot, items) {
    // Dated first (newest first); undated rows sink to the bottom.
    lootSorted = [...loot].sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    applyLootFilter();
    renderLootPage(1, items);
  }

  function applyLootFilter() {
    const q = lootSearch.trim().toLowerCase();
    lootFiltered = q
      ? lootSorted.filter((l) =>
          (l.player && l.player.toLowerCase().includes(q)) ||
          (l.item && l.item.toLowerCase().includes(q)) ||
          (l.raid && l.raid.toLowerCase().includes(q)))
      : lootSorted;
  }

  function renderLootPage(page, items) {
    const totalPages = Math.max(1, Math.ceil(lootFiltered.length / LOOT_PAGE_SIZE));
    lootPage = Math.min(Math.max(1, page), totalPages);
    const start = (lootPage - 1) * LOOT_PAGE_SIZE;
    const rows = lootFiltered.slice(start, start + LOOT_PAGE_SIZE);

    $("#loot-table tbody").innerHTML = rows.map((l) => `
      <tr>
        <td>${l.date ? esc(l.date) : "—"}</td>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, items.byName)}</td>
        <td class="num">${l.dkpSpent}</td>
      </tr>`).join("");

    $("#loot-table").hidden = rows.length === 0;
    const undated = lootFiltered.filter((l) => !l.date).length;
    const searched = lootSearch.trim() ? ` · matching “${lootSearch.trim()}”` : "";
    $("#loot-status").textContent = `${lootFiltered.length.toLocaleString()} loot awards · newest first${searched} · ` +
      (rows.length
        ? `showing ${start + 1}–${start + rows.length.toLocaleString()} (page ${lootPage} of ${totalPages.toLocaleString()})`
        : "no matches") +
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

  /* ---------------- roster ---------------- */
  const ROSTER_PAGE_SIZE = 25;
  let rosterAll = [];
  let rosterFiltered = [];
  let rosterPage = 1;
  let rosterState = { search: "", rank: "", mainAlt: "", cls: "", sortKey: "member", sortDir: 1 };

  function renderRoster(rows) {
    rosterAll = [...rows];
    populateRosterFilters();
    applyRosterFilters();
    renderRosterPage(1);
  }

  function populateRosterFilters() {
    const uniq = (key) => [...new Set(rosterAll.map((r) => r[key]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
    const fill = (sel, label, values) => {
      $(sel).innerHTML = `<option value="">All ${label}</option>` +
        values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    };
    fill("#roster-filter-rank", "rank", uniq("rank"));
    fill("#roster-filter-mainalt", "Main/Alt", uniq("mainAlt"));
    fill("#roster-filter-class", "class", uniq("cls"));
  }

  function applyRosterFilters() {
    const s = rosterState;
    const q = s.search.trim().toLowerCase();
    const filtered = rosterAll.filter((r) => {
      if (q && !(r.character.toLowerCase().includes(q) || r.member.toLowerCase().includes(q))) return false;
      if (s.rank && r.rank !== s.rank) return false;
      if (s.mainAlt && r.mainAlt !== s.mainAlt) return false;
      if (s.cls && r.cls !== s.cls) return false;
      return true;
    });
    const key = s.sortKey;
    filtered.sort((a, b) => {
      let av = a[key], bv = b[key];
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp === 0) cmp = a.member.localeCompare(b.member) || a.character.localeCompare(b.character);
      return cmp * s.sortDir;
    });
    rosterFiltered = filtered;
  }

  function renderRosterPage(page) {
    const totalPages = Math.max(1, Math.ceil(rosterFiltered.length / ROSTER_PAGE_SIZE));
    rosterPage = Math.min(Math.max(1, page), totalPages);
    const start = (rosterPage - 1) * ROSTER_PAGE_SIZE;
    const rows = rosterFiltered.slice(start, start + ROSTER_PAGE_SIZE);

    $("#roster-table tbody").innerHTML = rows.map((r) => `
      <tr>
        <td>${esc(r.character)}</td>
        <td><a href="#member" class="member-link" data-member="${esc(r.member)}">${esc(r.member)}</a></td>
        <td>${esc(r.cls)} · ${esc(r.race)} (${r.level})</td>
        <td>${esc(r.mainAlt)}</td>
        <td>${esc(r.rank)}</td>
        <td>${r.memberSince ? esc(r.memberSince) : "—"}</td>
      </tr>`).join("");

    $("#roster-table").hidden = rows.length === 0;
    const members = new Set(rosterFiltered.map((r) => r.member)).size;
    $("#roster-status").textContent = `${rosterFiltered.length.toLocaleString()} of ${rosterAll.length.toLocaleString()} characters · ${members.toLocaleString()} members · ` +
      (rows.length
        ? `showing ${start + 1}–${start + rows.length.toLocaleString()} (page ${rosterPage} of ${totalPages.toLocaleString()})`
        : "no characters");

    renderRosterPager(totalPages);
  }

  function renderRosterPager(totalPages) {
    const el = $("#roster-pager");
    if (totalPages <= 1) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;

    const pages = [1];
    const lo = Math.max(2, rosterPage - 2), hi = Math.min(totalPages - 1, rosterPage + 2);
    if (lo > 2) pages.push("…");
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (hi < totalPages - 1) pages.push("…");
    if (totalPages > 1) pages.push(totalPages);

    el.innerHTML =
      `<button class="pager-btn" data-page="${rosterPage - 1}"${rosterPage === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
      pages.map((p) => p === "…"
        ? `<span class="pager-ellipsis">…</span>`
        : `<button class="pager-btn${p === rosterPage ? " active" : ""}" data-page="${p}">${p.toLocaleString()}</button>`).join("") +
      `<button class="pager-btn" data-page="${rosterPage + 1}"${rosterPage === totalPages ? " disabled" : ""} aria-label="Next page">›</button>`;
  }

  /* ---------------- member detail ---------------- */
  const MEMBER_LOOT_CAP = 50;
  let db = null; // { users, loot, items, roster } — set in init()

  function showView(id) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`#${id}`).classList.add("active");
    window.scrollTo({ top: 0 });
  }

  function openMember(member) {
    if (!db) return;
    const m = member.toLowerCase();
    const user = db.users.find((u) => u.username.toLowerCase() === m) || null;
    const chars = db.roster.filter((r) => r.member.toLowerCase() === m);
    const charNames = new Set(chars.map((c) => c.character.toLowerCase()));

    // Prefer the account-level DKP from users.json; fall back to roster sums.
    const available = user ? user.activeDkp : chars.reduce((s, c) => s + c.availableDkp, 0);
    const earned = user ? user.earned : chars.reduce((s, c) => s + c.earnedDkp, 0);
    const spent = user ? user.spent : chars.reduce((s, c) => s + c.spentDkp, 0);

    $("#member-name").textContent = member;
    $("#member-available").textContent = available.toLocaleString();
    $("#member-earned").textContent = earned.toLocaleString();
    $("#member-spent").textContent = spent.toLocaleString();

    $("#member-characters").innerHTML = chars.length
      ? chars.map((c) =>
          `<span class="member-char">${esc(c.character)} · ${esc(c.cls)} (${c.level}) · ${esc(c.mainAlt || "—")}</span>`
        ).join("")
      : "<span class=\"panel-status\">No roster characters found.</span>";

    const memberLoot = db.loot.filter((l) => charNames.has(String(l.player).toLowerCase()));
    memberLoot.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    const shown = memberLoot.slice(0, MEMBER_LOOT_CAP);
    $("#member-loot-table tbody").innerHTML = shown.map((l) => `
      <tr>
        <td>${l.date ? esc(l.date) : "—"}</td>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, db.items.byName)}</td>
        <td>${l.raid ? esc(l.raid) : "—"}</td>
        <td class="num">${l.dkpSpent}</td>
      </tr>`).join("");
    $("#member-loot-table").hidden = shown.length === 0;
    $("#member-loot-status").textContent = memberLoot.length
      ? `${memberLoot.length.toLocaleString()} awards` +
        (memberLoot.length > MEMBER_LOOT_CAP ? ` · showing first ${MEMBER_LOOT_CAP}` : "")
      : "No loot awards found.";

    showView("member");
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
        <td class="num">${r.attendees.length}</td>
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
      const [items, loot, users, raids, roster] = await Promise.all([
        Data.loadItems(),
        Data.loadLoot(),
        Data.loadUsers(),
        Data.loadRaids(),
        Data.loadRoster(),
      ]);

      renderOverview(users, loot, items, raids, roster);
      renderStandings(users);
      renderItems(items);
      renderLoot(loot, items);
      renderRoster(roster);
      renderRaids(raids);
      db = { users, loot, items, roster };

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
      $("#recent-loot-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderRecentLootPage(Number(btn.dataset.page), items);
      });

      // Loot search (debounced)
      let lootTimer;
      $("#loot-search").addEventListener("input", (e) => {
        clearTimeout(lootTimer);
        lootTimer = setTimeout(() => {
          lootSearch = e.target.value;
          applyLootFilter();
          renderLootPage(1, items);
        }, 200);
      });
      $("#roster-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderRosterPage(Number(btn.dataset.page));
      });

      // Roster search + filters (debounced search; instant selects)
      let rosterTimer;
      $("#roster-search").addEventListener("input", (e) => {
        clearTimeout(rosterTimer);
        rosterTimer = setTimeout(() => {
          rosterState.search = e.target.value;
          applyRosterFilters();
          renderRosterPage(1);
        }, 200);
      });
      $("#roster-filter-rank").addEventListener("change", (e) => {
        rosterState.rank = e.target.value;
        applyRosterFilters();
        renderRosterPage(1);
      });
      $("#roster-filter-mainalt").addEventListener("change", (e) => {
        rosterState.mainAlt = e.target.value;
        applyRosterFilters();
        renderRosterPage(1);
      });
      $("#roster-filter-class").addEventListener("change", (e) => {
        rosterState.cls = e.target.value;
        applyRosterFilters();
        renderRosterPage(1);
      });

      // Sortable roster headers (delegated on the persistent thead)
      $("#roster-table thead").addEventListener("click", (e) => {
        const th = e.target.closest("th.sortable");
        if (!th) return;
        const key = th.dataset.sort;
        if (rosterState.sortKey === key) rosterState.sortDir *= -1;
        else { rosterState.sortKey = key; rosterState.sortDir = 1; }
        applyRosterFilters();
        renderRosterPage(1);
      });

      // Member drill-down: delegated on the persistent roster tbody
      $("#roster-table tbody").addEventListener("click", (e) => {
        const link = e.target.closest(".member-link");
        if (!link) return;
        e.preventDefault();
        openMember(link.dataset.member);
      });

      // Back from member page to the roster view
      $("#member-back").addEventListener("click", () => {
        showView("roster");
        document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
        document.querySelector('.nav-link[data-target="roster"]')?.classList.add("active");
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
