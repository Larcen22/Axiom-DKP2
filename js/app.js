/**
 * app.js — Axiom DKP Metrics: navigation + rendering
 */
(() => {
  "use strict";

  // data.js failed to load (missing file, syntax error, blocked script): fail visibly instead of shimmering forever.
  if (typeof Data === "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.classList.remove("app-loading");
      const msg = document.createElement("div");
      msg.className = "panel-status";
      msg.textContent = "Failed to load js/data.js — the dashboard cannot start. Check that the file exists and is uncorrupted.";
      (document.querySelector(".view.active") || document.body).prepend(msg);
    });
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const setStat = (id, value) => {
    const el = $(`#${id}`);
    if (el) el.textContent = value;
  };
  const esc = Data.escapeHtml;
  // Quarmy character lookup: opens a name search on quarmy.com (non-www host only —
  // www.quarmy.com returns 503). Opens in a new tab.
  const quarmyLink = (name) => `<a class="char-link" href="https://quarmy.com/public?q=${encodeURIComponent(name)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`;
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
  const RECENT_RAIDS_SHOWN = 8;
  const TOP_SPENDERS_N = 5;
  const ACTIVITY_WEEKS = 12;
  const JOINERS_SHOWN = 5;
  const CORE_RAIDS_MIN = 8; // raids in 30d to count as a "core" raider

  function renderOverview(users, loot, items, raids, roster) {
    // Stat cards
    // Items awarded in the past 7 days (dates are "YYYY-MM-DD", safe to compare as strings)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const weekLoot = loot.filter((l) => l.date && l.date >= cutoffStr);
    const itemsLastWeek = weekLoot.length;

    // Avg DKP spent per unique member (owner username_id) in the past 7 days.
    const totalSpentWeek = weekLoot.reduce((s, l) => s + l.dkpSpent, 0);
    const spendersWeek = new Set(weekLoot.map((l) => l.user || l.player)).size;
    const avgSpentWeek = spendersWeek ? totalSpentWeek / spendersWeek : null;

    // Average raid size over the past 30 days (attendees per raid). Dates are "YYYY-MM-DD".
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff30Str = `${cutoff30.getFullYear()}-${String(cutoff30.getMonth() + 1).padStart(2, "0")}-${String(cutoff30.getDate()).padStart(2, "0")}`;
    let recentRaidCount = 0, recentRaidAttendees = 0;
    // Members seen on a raid in the past 30 days (by owner username_id), used to scope Total DKP.
    const activeUserIds = new Set();
    for (const r of raids) {
      if (r.date && r.date >= cutoff30Str) {
        recentRaidCount++;
        recentRaidAttendees += r.attendees.length;
        for (const uid of r.attendeeUserIds) activeUserIds.add(uid);
      }
    }
    const avgRaidSize = recentRaidCount ? recentRaidAttendees / recentRaidCount : null;

    // Total DKP Available: only members seen on a raid in the past 30 days.
    const totalDkpAvailable = users.reduce(
      (s, u) => s + (activeUserIds.has(u.usernameId) ? u.activeDkp : 0),
      0
    );

    setStat("stat-total-dkp", totalDkpAvailable.toLocaleString());
    setStat("stat-items-awarded", itemsLastWeek.toLocaleString());
    setStat("stat-avg-spent-week", avgSpentWeek != null
      ? Math.round(avgSpentWeek).toLocaleString()
      : "–");
    setStat("stat-avg-raid-size", avgRaidSize != null
      ? Math.round(avgRaidSize).toLocaleString()
      : "–");

    // Insight panels: activity chart, recent raids, top spenders, biggest spends, class mix, joiners, raider trend
    renderOverviewPanels(users, loot, items, raids, roster);
  }

  function renderOverviewPanels(users, loot, items, raids, roster) {
    const now = new Date();
    const daysAgoOf = (dateStr) => Math.floor((now - new Date(dateStr + "T00:00:00")) / 86400000);

    // --- Guild activity: raids + DKP spent per week over the last ACTIVITY_WEEKS weeks (7-day buckets from today)
    const counts = new Array(ACTIVITY_WEEKS).fill(0);
    const spentWeeks = new Array(ACTIVITY_WEEKS).fill(0);
    let windowTotal = 0, spentTotal = 0;
    for (const r of raids) {
      if (!r.date) continue;
      const d = daysAgoOf(r.date);
      if (d < 0 || d >= ACTIVITY_WEEKS * 7) continue;
      counts[ACTIVITY_WEEKS - 1 - Math.floor(d / 7)]++;
      windowTotal++;
    }
    for (const l of loot) {
      if (!l.date) continue; // undated awards can't be bucketed
      const d = daysAgoOf(l.date);
      if (d < 0 || d >= ACTIVITY_WEEKS * 7) continue;
      spentWeeks[ACTIVITY_WEEKS - 1 - Math.floor(d / 7)] += l.dkpSpent;
      spentTotal += l.dkpSpent;
    }
    const maxCount = Math.max(...counts, 1);
    const maxSpent = Math.max(...spentWeeks, 1);
    $("#activity-chart").innerHTML = counts.map((c, i) => {
      const ws = new Date(now);
      ws.setDate(ws.getDate() - (ACTIVITY_WEEKS - 1 - i) * 7);
      const label = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
      const s = spentWeeks[i];
      return `<div class="week-group" title="${label}: ${c} raid${c === 1 ? "" : "s"} · ${s.toLocaleString()} DKP spent">` +
        `<div class="activity-bar bar-raids${c ? "" : " zero"}" style="height:${c ? Math.max(8, (c / maxCount) * 100) : 3}%"></div>` +
        `<div class="activity-bar bar-spent${s > 0 ? "" : " zero"}" style="height:${s > 0 ? Math.max(8, (s / maxSpent) * 100) : 3}%"></div></div>`;
    }).join("");
    $("#activity-status").textContent = `${windowTotal.toLocaleString()} raids · ${spentTotal.toLocaleString()} DKP spent in the past ${ACTIVITY_WEEKS} weeks`;

    // --- Recent raids (newest first)
    const recentRaids = [...raids].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_RAIDS_SHOWN);
    // Items awarded per raid, joined on the exact raid id (raid names repeat over time).
    const lootByRaidId = new Map();
    for (const l of loot) if (l.raidId) lootByRaidId.set(l.raidId, (lootByRaidId.get(l.raidId) || 0) + 1);
    $("#recent-raids-table tbody").innerHTML = recentRaids.map((r) => `
      <tr>
        <td>${esc(r.date)}</td>
        <td><a href="#raid" class="raid-link" data-id="${esc(r.id)}" data-return="overview">${esc(r.name || r.id)}</a></td>
        <td class="num">${r.attendees.length}</td>
        <td class="num">${lootByRaidId.get(r.id) || 0}</td>
      </tr>`).join("");
    $("#recent-raids-table").hidden = recentRaids.length === 0;
    $("#recent-raids-status").textContent = recentRaids.length
      ? `Last ${recentRaids.length} of ${raids.length.toLocaleString()} raids`
      : "No raids recorded.";

    // --- Top spenders, past 30 days (loot entries carry raid-resolved dates from data.js)
    const cutoff30 = new Date(now);
    cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff30Str = `${cutoff30.getFullYear()}-${String(cutoff30.getMonth() + 1).padStart(2, "0")}-${String(cutoff30.getDate()).padStart(2, "0")}`;
    const memberByUser = new Map(users.map((u) => [u.usernameId, u.username]));
    const spent30 = new Map();
    for (const l of loot) {
      if (!l.date || l.date < cutoff30Str) continue;
      const name = memberByUser.get(l.user) || l.player;
      spent30.set(name, (spent30.get(name) || 0) + l.dkpSpent);
    }
    const topSpenders = [...spent30.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_SPENDERS_N);
    $("#top-spenders-list").innerHTML = topSpenders.map(([name, amt], i) => `
      <li>
        <span class="rank-num">${i + 1}</span>
        <a href="#member" class="member-link rank-name" data-member="${esc(name)}" data-return="overview">${esc(name)}</a>
        <span class="rank-val">${amt.toLocaleString()}</span>
      </li>`).join("");
    $("#top-spenders-status").textContent = topSpenders.length
      ? `Top ${topSpenders.length} of ${spent30.size.toLocaleString()} members who spent DKP in the past 30 days`
      : "No DKP spent in the past 30 days.";

    // --- Most active members, past 30 days (raids attended by owner username_id)
    const attendance = new Map();
    for (const r of raids) {
      if (!r.date || r.date < cutoff30Str) continue;
      for (const uid of r.attendeeUserIds) attendance.set(uid, (attendance.get(uid) || 0) + 1);
    }
    const mostActive = [...attendance.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_SPENDERS_N);
    $("#most-active-list").innerHTML = mostActive.map(([uid, n], i) => {
      const name = memberByUser.get(uid) || uid;
      return `
      <li>
        <span class="rank-num">${i + 1}</span>
        <a href="#member" class="member-link rank-name" data-member="${esc(name)}" data-return="overview">${esc(name)}</a>
        <span class="rank-val">${n} raid${n === 1 ? "" : "s"}</span>
      </li>`;
    }).join("");
    const coreCount = [...attendance.values()].filter((n) => n >= CORE_RAIDS_MIN).length;
    $("#most-active-status").textContent = attendance.size
      ? `${coreCount.toLocaleString()} core raiders (${CORE_RAIDS_MIN}+ raids) of ${attendance.size.toLocaleString()} active members`
      : "No raids in the past 30 days.";

    // --- Biggest single spends, past 30 days
    const biggest = loot.filter((l) => l.date && l.date >= cutoff30Str)
      .sort((a, b) => b.dkpSpent - a.dkpSpent).slice(0, TOP_SPENDERS_N);
    $("#biggest-spends-list").innerHTML = biggest.map((l, i) => `
      <li>
        <span class="rank-num">${i + 1}</span>
        <span class="rank-name">${Data.itemLink(l.item, items.byName)}</span>
        <span class="rank-sub">${esc(l.player)}</span>
        <span class="rank-val">${l.dkpSpent.toLocaleString()}</span>
      </li>`).join("");
    $("#biggest-spends-status").textContent = biggest.length
      ? `Top ${biggest.length} single awards in the past 30 days`
      : "No loot awarded in the past 30 days.";

    // --- Characters by class (roster is one row per character), scoped to members seen on a raid in the past 30 days
    const activeUserIds = new Set();
    for (const r of raids) {
      if (!r.date || r.date < cutoff30Str) continue;
      for (const uid of r.attendeeUserIds) activeUserIds.add(uid);
    }
    const userByName = new Map(users.map((u) => [u.username, u.usernameId]));
    const clsCount = new Map();
    const activeMembers = new Set();
    let mains = 0, alts = 0;
    for (const row of roster) {
      if (!row.cls) continue;
      if (!activeUserIds.has(userByName.get(row.member))) continue;
      activeMembers.add(row.member);
      clsCount.set(row.cls, (clsCount.get(row.cls) || 0) + 1);
      if (row.mainAlt === "main") mains++;
      else if (row.mainAlt === "alternate") alts++;
    }
    const classes = [...clsCount.entries()].sort((a, b) => b[1] - a[1]);
    const maxCls = Math.max(...classes.map(([, n]) => n), 1);
    $("#class-comp-list").innerHTML = classes.map(([cls, n]) => `
      <div class="bar-row">
        <span class="bar-name">${esc(cls)}</span>
        <span class="bar-count">${n}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(n / maxCls) * 100}%"></div></div>
      </div>`).join("");
    $("#class-comp-status").textContent = classes.length
      ? `${[...clsCount.values()].reduce((a, b) => a + b, 0).toLocaleString()} characters from ${activeMembers.size.toLocaleString()} members seen in the past 30 days · ${classes.length} classes · ${mains} mains / ${alts} alts`
      : "No members seen on raids in the past 30 days.";

    // --- Recent joiners (earliest applied/memberSince per member, newest first)
    const joined = new Map();
    for (const row of roster) {
      const d = [row.applied, row.memberSince].filter(Boolean).sort()[0];
      if (!d) continue;
      const prev = joined.get(row.member);
      if (!prev || d < prev) joined.set(row.member, d);
    }
    const joiners = [...joined.entries()].sort((a, b) => b[1].localeCompare(a[1])).slice(0, JOINERS_SHOWN);
    $("#recent-joiners-list").innerHTML = joiners.map(([name, d], i) => {
      const days = Math.max(0, daysAgoOf(d));
      return `
      <li>
        <span class="rank-num">${i + 1}</span>
        <a href="#member" class="member-link rank-name" data-member="${esc(name)}" data-return="overview">${esc(name)}</a>
        <span class="rank-val">${d} · ${days === 0 ? "today" : `${days}d ago`}</span>
      </li>`;
    }).join("");
    const joinedLast30 = [...joined.values()].filter((d) => d >= cutoff30Str).length;
    $("#recent-joiners-status").textContent = joiners.length
      ? `Newest members · ${joinedLast30.toLocaleString()} joined in the past 30 days (of ${joined.size.toLocaleString()} with a recorded join date)`
      : "No join dates in the roster export.";

    // --- Raider trend: unique attendees per week over the last ACTIVITY_WEEKS weeks
    const raiderSets = Array.from({ length: ACTIVITY_WEEKS }, () => new Set());
    const raidCountsWeeks = Array(ACTIVITY_WEEKS).fill(0);
    for (const r of raids) {
      if (!r.date || !r.attendeeUserIds) continue;
      const d = daysAgoOf(r.date);
      if (d < 0 || d >= ACTIVITY_WEEKS * 7) continue;
      const idx = ACTIVITY_WEEKS - 1 - Math.floor(d / 7);
      raidCountsWeeks[idx]++;
      for (const uid of r.attendeeUserIds) raiderSets[idx].add(uid);
    }
    const raidersWeeks = raiderSets.map((s) => s.size);
    const maxRaiders = Math.max(...raidersWeeks, 1);
    $("#raider-chart").innerHTML = raidersWeeks.map((n, i) => {
      const ws = new Date(now);
      ws.setDate(ws.getDate() - (ACTIVITY_WEEKS - 1 - i) * 7);
      const label = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
      return `<div class="activity-bar bar-raiders${n ? "" : " zero"}" style="height:${n ? Math.max(8, (n / maxRaiders) * 100) : 3}%" title="${label}: ${n} unique raiders"></div>`;
    }).join("");
    // Average over weeks that actually had raids, so empty weeks (e.g. a young guild)
    // don't drag the number down.
    const activeWeeks = raidCountsWeeks.filter((c) => c > 0).length;
    const avgRaiders = activeWeeks ? Math.round(raidersWeeks.reduce((a, b) => a + b, 0) / activeWeeks) : 0;
    const scopeNote = activeWeeks === ACTIVITY_WEEKS ? "" : ` across ${activeWeeks} active weeks`;
    $("#raider-trend-status").textContent = `Avg ${avgRaiders} unique raiders per week${scopeNote} · peak ${Math.max(...raidersWeeks)} in one week`;
  }


  /* ---------------- raider standings ---------------- */
  let standingsAll = []; // enriched users (unsorted)
  let standingsSorted = [];
  let standingsFiltered = [];
  let standingsSearch = "";
  let standingsSort = { key: "activeDkp", dir: -1 }; // default: active DKP, biggest first
  let standingsPage = 1;

  function renderStandings(users, raids, roster) {
    // Same window semantics as Member Detail: windows are clamped to each member's join date,
    // lifetime starts at the join date (no join date -> "–"), presence = username_id OR character name.
    const cutoffFor = (days) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const cutoffs = [30, 60, 90].map(cutoffFor);

    // Earliest applied/memberSince per member (same as openMember).
    const joinedByMember = new Map();
    for (const row of roster) {
      for (const d of [row.applied, row.memberSince]) {
        if (!d) continue;
        const prev = joinedByMember.get(row.member);
        if (!prev || d < prev) joinedByMember.set(row.member, d);
      }
    }
    const uidOfUser = new Map(users.map((u) => [u.username, u.usernameId]));
    const joinedById = new Map();
    for (const u of users) joinedById.set(u.usernameId, joinedByMember.get(u.username) || "");

    // Character name -> username_id, so presence also matches roster names (openMember's isPresent union).
    const charNameToUid = new Map();
    for (const row of roster) {
      const uid = uidOfUser.get(row.member);
      if (uid && !charNameToUid.has(row.character.toLowerCase())) charNameToUid.set(row.character.toLowerCase(), uid);
    }

    // Sorted raid dates -> O(log n) "total raids since X" lookups.
    const raidDates = raids.map((r) => r.date).filter(Boolean).sort();
    const totalSince = (start) => {
      if (!start) return 0;
      let lo = 0, hi = raidDates.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (raidDates[mid] < start) lo = mid + 1; else hi = mid;
      }
      return raidDates.length - lo;
    };

    // Single pass over raids: per-member attended counts for the three clamped windows + lifetime.
    const counts = new Map(); // usernameId -> [n30, n60, n90, nLife]
    for (const r of raids) {
      if (!r.date) continue;
      const credited = new Set(r.attendeeUserIds);
      for (const name of r.attendees) {
        const uid = charNameToUid.get(name.toLowerCase());
        if (uid) credited.add(uid);
      }
      for (const uid of credited) {
        let c = counts.get(uid);
        if (!c) { c = [0, 0, 0, 0]; counts.set(uid, c); }
        const jo = joinedById.get(uid) || "";
        for (let i = 0; i < 3; i++) {
          const start = jo > cutoffs[i] ? jo : cutoffs[i];
          if (r.date >= start) c[i]++;
        }
        if (jo && r.date >= jo) c[3]++;
      }
    }

    const fmt = (a, t) => (t ? `${Math.round((a / t) * 100)}% (${a}/${t})` : "–");
    const pctOf = (a, t) => (t ? Math.round((a / t) * 100) : null);

    standingsAll = users.map((u) => {
      const c = counts.get(u.usernameId) || [0, 0, 0, 0];
      const jo = joinedById.get(u.usernameId) || "";
      const totals = [
        totalSince(jo > cutoffs[0] ? jo : cutoffs[0]),
        totalSince(jo > cutoffs[1] ? jo : cutoffs[1]),
        totalSince(jo > cutoffs[2] ? jo : cutoffs[2]),
        totalSince(jo),
      ];
      return {
        ...u,
        att30: fmt(c[0], totals[0]), p30: pctOf(c[0], totals[0]),
        att60: fmt(c[1], totals[1]), p60: pctOf(c[1], totals[1]),
        att90: fmt(c[2], totals[2]), p90: pctOf(c[2], totals[2]),
        attLife: fmt(c[3], totals[3]), pLife: pctOf(c[3], totals[3]),
      };
    });
    applyStandingsSort();
    renderStandingsPage(1);
  }

  function applyStandingsSort() {
    const { key, dir } = standingsSort;
    standingsSorted = [...standingsAll].sort((a, b) => {
      const av = a[key], bv = b[key];
      // "–" (no raids in window / no join date) always sorts last.
      if (av == null || bv == null) return av == null ? 1 : -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return (cmp || a.username.localeCompare(b.username)) * dir;
    });
    applyStandingsFilter();
  }

  function markSortHeaders(tableSel, sortKey, dir) {
    document.querySelectorAll(`${tableSel} thead th`).forEach((th) => th.classList.remove("sorted-asc", "sorted-desc"));
    const th = document.querySelector(`${tableSel} thead th[data-sort="${sortKey}"]`);
    if (th) th.classList.add(dir === 1 ? "sorted-asc" : "sorted-desc");
  }

  function applyStandingsFilter() {
    const q = standingsSearch.trim().toLowerCase();
    standingsFiltered = q
      ? standingsSorted.filter((u) => u.username.toLowerCase().includes(q))
      : standingsSorted;
  }

  function renderStandingsPage(page) {
    const totalPages = Math.max(1, Math.ceil(standingsFiltered.length / STANDINGS_PAGE_SIZE));
    standingsPage = Math.min(Math.max(1, page), totalPages);
    const start = (standingsPage - 1) * STANDINGS_PAGE_SIZE;
    const rows = standingsFiltered.slice(start, start + STANDINGS_PAGE_SIZE);

    $("#standings-table tbody").innerHTML = rows.map((u, i) => {
      const rank = start + i + 1;
      const medal = rank <= 3 ? ` rank-${rank}` : "";
      const dkpCls = u.activeDkp > 0 ? "dkp-positive" : "dkp-zero";
      return `
      <tr>
        <td class="num rank-medal${medal}">${rank}</td>
        <td><a href="#member" class="member-link" data-member="${esc(u.username)}" data-return="standings">${esc(u.username)}</a></td>
        <td class="num ${dkpCls}">${u.activeDkp.toLocaleString()}</td>
        <td class="num">${u.earned.toLocaleString()}</td>
        <td class="num">${u.spent.toLocaleString()}</td>
        <td class="num" title="Attended / available raids in the past 30 days (clamped to join date)">${u.att30}</td>
        <td class="num" title="Attended / available raids in the past 60 days (clamped to join date)">${u.att60}</td>
        <td class="num" title="Attended / available raids in the past 90 days (clamped to join date)">${u.att90}</td>
        <td class="num" title="Attended / available raids since joining">${u.attLife}</td>
      </tr>`;
    }).join("");

    $("#standings-table").hidden = rows.length === 0;
    const status = $("#standings-status");
    const searched = standingsSearch.trim() ? ` · matching “${standingsSearch.trim()}”` : "";
    status.textContent = `${standingsFiltered.length.toLocaleString()} raiders by active DKP${searched} · ` +
      (rows.length
        ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${standingsPage} of ${totalPages.toLocaleString()})`
        : "no raiders");

    markSortHeaders("#standings-table", standingsSort.key, standingsSort.dir);
    renderPager("standings-pager", standingsPage, totalPages);
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
        <td>${l.raid ? esc(l.raid) : "—"}</td>
        <td class="num">${l.dkpSpent.toLocaleString()}</td>
      </tr>`).join("");

    $("#loot-table").hidden = rows.length === 0;
    const undated = lootFiltered.filter((l) => !l.date).length;
    const searched = lootSearch.trim() ? ` · matching “${lootSearch.trim()}”` : "";
    $("#loot-status").textContent = `${lootFiltered.length.toLocaleString()} loot awards · newest first${searched} · ` +
      (rows.length
        ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${lootPage} of ${totalPages.toLocaleString()})`
        : "no matches") +
      (undated ? ` · ${undated.toLocaleString()} undated` : "");

    renderPager("loot-pager", lootPage, totalPages);
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
        <td>${quarmyLink(r.character)}</td>
        <td><a href="#member" class="member-link" data-member="${esc(r.member)}" data-return="roster">${esc(r.member)}</a></td>
        <td>${esc(r.cls)} · ${esc(r.race)} (${r.level})</td>
        <td>${esc(r.mainAlt)}</td>
        <td>${esc(r.rank)}</td>
        <td>${r.memberSince ? esc(r.memberSince) : "—"}</td>
      </tr>`).join("");

    $("#roster-table").hidden = rows.length === 0;
    const members = new Set(rosterFiltered.map((r) => r.member)).size;
    $("#roster-status").textContent = `${rosterFiltered.length.toLocaleString()} of ${rosterAll.length.toLocaleString()} characters · ${members.toLocaleString()} members · ` +
      (rows.length
        ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${rosterPage} of ${totalPages.toLocaleString()})`
        : "no characters");

    markSortHeaders("#roster-table", rosterState.sortKey, rosterState.sortDir);
    renderPager("roster-pager", rosterPage, totalPages);
  }


  /* ---------------- member detail ---------------- */

  let db = null; // { users, loot, items, roster } — set in init()

  function showView(id) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`#${id}`).classList.add("active");
    window.scrollTo({ top: 0 });
  }

  let memberReturnView = "roster"; // where the back button returns to (set by the clicked link)

  function openMember(member, returnView) {
    if (!db) return;
    memberReturnView = returnView || "roster";
    const m = member.toLowerCase();
    const user = db.users.find((u) => u.username.toLowerCase() === m) || null;
    const chars = db.roster.filter((r) => r.member.toLowerCase() === m);
    const charNames = new Set(chars.map((c) => c.character.toLowerCase()));

    // Prefer the account-level DKP from users.json; fall back to roster sums.
    const available = user ? user.activeDkp : chars.reduce((s, c) => s + c.availableDkp, 0);
    const earned = user ? user.earned : chars.reduce((s, c) => s + c.earnedDkp, 0);
    const spent = user ? user.spent : chars.reduce((s, c) => s + c.spentDkp, 0);

    // Attendance: a raid counts as attended when one of this member's characters (or their account) was present.
    const userIds = new Set(user && user.usernameId ? [user.usernameId] : []);
    const isPresent = (r) =>
      r.attendeeUserIds.some((id) => userIds.has(id)) ||
      r.attendees.some((c) => charNames.has(String(c).toLowerCase()));

    // Join date: earliest of ApplicationDate / MembershipDate.
    const joinDates = chars.flatMap((c) => [c.applied, c.memberSince]).filter(Boolean).sort();
    const joinedOn = joinDates[0] || null;

    // Single pass over raids: total attended + per-window totals (30/60/90d and lifetime-since-join).
    const cutoffFor = (days) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    // Windows are clamped to the member's join date: a 2-week member's "30D" covers their actual 2 weeks.
    const sinceJoin = (base) => (joinedOn && joinedOn > base ? joinedOn : base);
    const windows = [
      ["30", sinceJoin(cutoffFor(30))],
      ["60", sinceJoin(cutoffFor(60))],
      ["90", sinceJoin(cutoffFor(90))],
      ["lifetime", joinedOn || ""], // no join date -> window stays empty, stat shows "–"
    ];
    let raidsAttended = 0;
    const winTotal = Object.fromEntries(windows.map(([k]) => [k, 0]));
    const winAttended = Object.fromEntries(windows.map(([k]) => [k, 0]));
    for (const r of db.raids) {
      const present = isPresent(r); // computed once per raid (used below + for the lifetime count)
      if (present) raidsAttended++;
      if (!r.date) continue; // undated raids can't be placed in a window
      for (const [key, cutoff] of windows) {
        if (cutoff && r.date >= cutoff) {
          winTotal[key]++;
          if (present) winAttended[key]++;
        }
      }
    }
    const raidsSinceJoin = joinedOn ? winTotal.lifetime : null;
    const pct = (a, t) => (t ? `${Math.round((a / t) * 100)}%` : "–");

    $("#member-name").textContent = member;
    // Roster Rank: hide the default ("member"), surface officer / guild leader / inactive / applicant / former.
    const rank = chars.map((c) => c.rank).find(Boolean) || "";
    $("#member-rank").hidden = !rank || rank.toLowerCase() === "member";
    $("#member-rank").textContent = rank;
    $("#member-available").textContent = available.toLocaleString();
    $("#member-earned").textContent = earned.toLocaleString();
    $("#member-spent").textContent = spent.toLocaleString();
    $("#member-raids-attended").textContent = raidsAttended.toLocaleString();
    $("#member-raids-since").textContent = raidsSinceJoin != null ? raidsSinceJoin.toLocaleString() : "–";
    $("#member-raids-since-label").textContent = joinedOn ? `since ${joinedOn}` : "(no join date)";
    $("#member-att-30").textContent = pct(winAttended["30"], winTotal["30"]);
    $("#member-att-60").textContent = pct(winAttended["60"], winTotal["60"]);
    $("#member-att-90").textContent = pct(winAttended["90"], winTotal["90"]);
    $("#member-att-lifetime").textContent = pct(winAttended.lifetime, winTotal.lifetime);
    $("#member-att-lifetime-label").textContent = joinedOn ? `Lifetime (since ${joinedOn})` : "Lifetime";

    $("#member-characters").innerHTML = chars.length
      ? chars.map((c) =>
          `<span class="member-char">${quarmyLink(c.character)} · ${esc(c.cls)} (${c.level}) · ${esc(c.mainAlt || "—")}</span>`
        ).join("")
      : "<span class=\"panel-status\">No roster characters found.</span>";

    memberLootSorted = db.loot.filter((l) => charNames.has(String(l.player).toLowerCase()));
    memberLootSorted.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    renderMemberLootPage(1);

    showView("member");
  }

  const MEMBER_LOOT_PAGE_SIZE = 10;
  let memberLootSorted = [];
  let memberLootPage = 1;

  function renderMemberLootPage(page) {
    const totalPages = Math.max(1, Math.ceil(memberLootSorted.length / MEMBER_LOOT_PAGE_SIZE));
    memberLootPage = Math.min(Math.max(1, page), totalPages);
    const start = (memberLootPage - 1) * MEMBER_LOOT_PAGE_SIZE;
    const rows = memberLootSorted.slice(start, start + MEMBER_LOOT_PAGE_SIZE);

    $("#member-loot-table tbody").innerHTML = rows.map((l) => `
      <tr>
        <td>${l.date ? esc(l.date) : "—"}</td>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, db.items.byName)}</td>
        <td>${l.raid ? esc(l.raid) : "—"}</td>
        <td class="num">${l.dkpSpent.toLocaleString()}</td>
      </tr>`).join("");

    $("#member-loot-table").hidden = rows.length === 0;
    $("#member-loot-status").textContent = memberLootSorted.length
      ? `${memberLootSorted.length.toLocaleString()} awards · newest first · ` +
        (rows.length
          ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${memberLootPage} of ${totalPages.toLocaleString()})`
          : "no awards")
      : "No loot awards found.";

    renderPager("member-loot-pager", memberLootPage, totalPages);
  }

  /* ---------------- raid detail ---------------- */
  const RAID_LOOT_PAGE_SIZE = 10;
  let raidLootSorted = [];
  let raidLootPage = 1;
  let raidReturnView = "raids"; // where the back button returns to (set by the clicked link)

  function openRaid(raidId, returnView) {
    if (!db || !raidId) return;
    const r = db.raids.find((x) => x.id === raidId);
    if (!r) return;
    raidReturnView = returnView || "raids";

    $("#raid-name").textContent = r.name || "Unknown raid";
    $("#raid-date").hidden = !r.date;
    $("#raid-date").textContent = r.date || "";

    // Loot for this exact raid — joined on raid_id (names repeat over time).
    const lootHere = db.loot.filter((l) => l.raidId === raidId);
    $("#raid-items").textContent = lootHere.length.toLocaleString();
    $("#raid-dkp-spent").textContent = lootHere.reduce((sum, l) => sum + l.dkpSpent, 0).toLocaleString();

    // Group attendees by member via roster character names; unrostered characters stand alone.
    const charToMember = new Map(db.roster.map((row) => [row.character.toLowerCase(), row.member]));
    const byMember = new Map(); // member -> [character, ...]
    const loose = [];
    for (const c of r.attendees) {
      const m = charToMember.get(String(c).toLowerCase());
      if (m) {
        if (!byMember.has(m)) byMember.set(m, []);
        byMember.get(m).push(c);
      } else loose.push(c);
    }
    $("#raid-attendees").textContent = (byMember.size + loose.length).toLocaleString();

    // Compact wrapping chips: member name (clickable) + characters only when a
    // member multi-boxed. Unrostered characters get dashed "loose" chips — the
    // status line already explains how many those are.
    const attendeeRows = [
      ...[...byMember.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, chars]) => `
        <li>
          <a href="#member" class="member-link" data-member="${esc(m)}" data-return="raid">${esc(m)}</a>${chars.length > 1 ? `<span class="chip-chars">${chars.map((c) => quarmyLink(c)).join(", ")}</span>` : ""}
        </li>`),
      ...loose.sort((a, b) => String(a).localeCompare(String(b))).map((c) => `
        <li class="loose"><span class="chip-name">${quarmyLink(c)}</span></li>`),
    ];
    $("#raid-attendee-list").innerHTML = attendeeRows.join("");
    $("#raid-attendees-status").textContent = r.attendees.length
      ? `${byMember.size} members \u00b7 ${r.attendees.length} characters attended` + (loose.length ? ` (${loose.length} not in roster)` : "")
      : "No attendees recorded.";

    raidLootSorted = [...lootHere].sort(
      (a, b) => b.dkpSpent - a.dkpSpent || String(a.item).localeCompare(String(b.item))
    );
    renderRaidLootPage(1);
    showView("raid");
  }

  function renderRaidLootPage(page) {
    const totalPages = Math.max(1, Math.ceil(raidLootSorted.length / RAID_LOOT_PAGE_SIZE));
    raidLootPage = Math.min(Math.max(1, page), totalPages);
    const start = (raidLootPage - 1) * RAID_LOOT_PAGE_SIZE;
    const rows = raidLootSorted.slice(start, start + RAID_LOOT_PAGE_SIZE);

    // Owner: resolve the character to a roster member for the profile drill-down.
    const charToMember = new Map(db.roster.map((row) => [row.character.toLowerCase(), row.member]));
    $("#raid-loot-table tbody").innerHTML = rows.map((l) => {
      const owner = charToMember.get(String(l.player).toLowerCase());
      return `
      <tr>
        <td>${esc(l.player)}</td>
        <td>${Data.itemLink(l.item, db.items.byName)}</td>
        <td>${owner ? `<a href="#member" class="member-link" data-member="${esc(owner)}" data-return="raid">${esc(owner)}</a>` : "\u2014"}</td>
        <td class="num">${l.dkpSpent.toLocaleString()}</td>
      </tr>`;
    }).join("");

    $("#raid-loot-table").hidden = rows.length === 0;
    $("#raid-loot-status").textContent = raidLootSorted.length
      ? `${raidLootSorted.length.toLocaleString()} awards \u00b7 biggest first \u00b7 ` +
        (rows.length
          ? `showing ${start + 1}\u2013${(start + rows.length).toLocaleString()} (page ${raidLootPage} of ${totalPages.toLocaleString()})`
          : "no awards")
      : "No loot awarded in this raid.";

    renderPager("raid-loot-pager", raidLootPage, totalPages);
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
        <td><a href="#raid" class="raid-link" data-id="${esc(r.id)}" data-return="raids">${esc(r.name)}</a></td>
        <td class="num">${r.dkpValue}</td>
        <td class="raid-attendees">${r.attendees.map(esc).join(", ")}</td>
        <td class="num">${r.attendees.length}</td>
      </tr>`).join("");

    $("#raids-table").hidden = rows.length === 0;
    $("#raids-status").textContent = `${raidsSorted.length.toLocaleString()} raids · newest first · ` +
      (rows.length ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${raidPage} of ${totalPages.toLocaleString()})` : "no raids");

    renderPager("raids-pager", raidPage, totalPages);
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
      renderStandings(users, raids, roster);

      // Standings search (debounced)
      let standingsTimer;
      $("#standings-search").addEventListener("input", (e) => {
        clearTimeout(standingsTimer);
        standingsTimer = setTimeout(() => {
          standingsSearch = e.target.value;
          applyStandingsFilter();
          renderStandingsPage(1);
        }, 200);
      });
      renderLoot(loot, items);
      renderRoster(roster);
      renderRaids(raids);
      db = { users, loot, items, roster, raids };

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
      $("#member-loot-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderMemberLootPage(Number(btn.dataset.page));
      });
      $("#raid-loot-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderRaidLootPage(Number(btn.dataset.page));
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

      // Sortable standings headers (numeric columns start biggest-first)
      $("#standings-table thead").addEventListener("click", (e) => {
        const th = e.target.closest("th.sortable");
        if (!th) return;
        const key = th.dataset.sort;
        if (standingsSort.key === key) standingsSort.dir *= -1;
        else standingsSort = { key, dir: -1 };
        applyStandingsSort();
        renderStandingsPage(1);
      });

      // Member drill-down: delegated globally so .member-link works in any view
      document.addEventListener("click", (e) => {
        const link = e.target.closest(".member-link");
        if (!link) return;
        e.preventDefault();
        openMember(link.dataset.member, link.dataset.return);
      });

      // Back from the member page to wherever we came in from (any view with a .member-link).
      $("#member-back").addEventListener("click", () => {
        showView(memberReturnView);
        document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
        document.querySelector(`.nav-link[data-target="${memberReturnView}"]`)?.classList.add("active");
      });

      // Raid drill-down: raid names are clickable in any view (Recent Raids, Raid History).
      document.addEventListener("click", (e) => {
        const link = e.target.closest(".raid-link");
        if (!link) return;
        e.preventDefault();
        openRaid(link.dataset.id, link.dataset.return);
      });

      // Back from the raid page to wherever we came in from (overview or raids).
      $("#raid-back").addEventListener("click", () => {
        showView(raidReturnView);
        document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
        document.querySelector(`.nav-link[data-target="${raidReturnView}"]`)?.classList.add("active");
      });

      document.body.classList.remove("app-loading");
    } catch (err) {
      console.error(err);
      document.body.classList.remove("app-loading");
      document.querySelectorAll(".panel-status").forEach((el) => {
        el.textContent = `Failed to load data: ${err.message}`;
        el.classList.add("error");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
