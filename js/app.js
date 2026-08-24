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
  // Count-up for stat cards: eases 0 → value over ~650ms. Respects prefers-reduced-motion
  // (and renders instantly when the value is null/"–").
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function animateCount(el, value) {
    if (!el) return;
    if (value == null || !Number.isFinite(value)) { el.textContent = "–"; return; }
    if (REDUCED_MOTION) { el.textContent = value.toLocaleString(); return; }
    const dur = 650, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(value * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const esc = Data.escapeHtml;
  const isoDate = Data.isoDate;

  // Tiny inline SVG trend line for stat cards (decorative — the number is the value).
  // Returns "" when there is nothing to draw so the container collapses away.
  function sparkline(values, color) {
    if (!values.length || Math.max(...values) === 0) return "";
    const max = Math.max(...values);
    const W = 100, H = 26, pad = 2;
    const pts = values.map((v, i) => {
      const x = values.length === 1 ? W / 2 : (i / (values.length - 1)) * (W - 2 * pad) + pad;
      const y = H - pad - (v / max) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const areaPts = `${pad},${H} ${pts} ${W - pad},${H}`;
    return `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polygon points="${areaPts}" fill="${color}" opacity="0.12"></polygon>` +
      `<polyline class="spark-line" points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" pathLength="100" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }

  // Signed DKP for adjustment transactions: "+15" / "-4", colored by sign.
  const fmtSignedDkp = (n) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
  const signedDkpClass = (n) => `num ${n > 0 ? "dkp-positive" : n < 0 ? "net-negative" : ""}`.trim();
  // Quarmy character lookup: opens a name search on quarmy.com (non-www host only —
  // www.quarmy.com returns 503). Opens in a new tab.
  const quarmyLink = (name) => `<a class="char-link" href="https://quarmy.com/public?q=${encodeURIComponent(name)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`;
  const RECENT_LOOT_PAGE_SIZE = 25;
  const STANDINGS_PAGE_SIZE = 25;

  /* ---------------- hash routing ---------------- */
  // The URL is the source of truth for the current view: #/<view> for nav views,
  // #/member/<name>, #/raid/<id> and #/trend/<key> for drill-downs (percent-encoded).
  // Every navigation pushes a history entry, so browser back/forward (incl. mobile
  // hardware back) work natively, refresh keeps state, and deep links restore the
  // exact view on load.
  const NAV_VIEWS = ["overview", "standings", "loot", "roster", "raids"];

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    if (!raw) return { view: "overview" };
    const [head, ...rest] = raw.split("/");
    if (head === "member") return { view: "member", name: decodeURIComponent(rest.join("/") || "") };
    if (head === "raid") return { view: "raid", id: rest.join("/") || "" };
    if (head === "trend") {
      const key = rest.join("/");
      // Unknown metric keys fall back to Overview — openTrend has no not-found state.
      return TREND_VIEWS[key] ? { view: "trend", key } : { view: "overview" };
    }
    if (NAV_VIEWS.includes(head)) return { view: head };
    return { view: "overview" }; // unknown fragment -> default view
  }

  function routeToHash(route) {
    if (route.view === "member") return `#/member/${encodeURIComponent(route.name)}`;
    if (route.view === "raid") return `#/raid/${encodeURIComponent(route.id)}`;
    if (route.view === "trend") return `#/trend/${encodeURIComponent(route.key)}`;
    return `#/${route.view}`;
  }

  // Pushes a history entry unless the hash is already current. replace=true is only
  // used to normalize the URL on load without polluting history.
  function navigate(route, replace = false) {
    const hash = routeToHash(route);
    if (location.hash === hash) return;
    if (replace) history.replaceState(null, "", hash); // no hashchange fires — don't set the direction flag
    else {
      inAppNav = true; // consumed by the next hashchange → forward push
      location.hash = hash;
    }
  }

  // Renders whatever the URL says. Nav views activate their section + nav item;
  // drill-downs clear the nav highlight (restored when back returns to a view).
  // View transition direction: in-app navigations (nav links, palette) are forward
  // pushes; native back/forward resolve against a small route stack so the entering
  // view slides from the correct side. data-dir must be set before showView() applies .active.
  let inAppNav = false;
  const navStack = [];
  function markNavDir(viewId, key) {
    const el = document.getElementById(viewId);
    if (!el) return;
    const top = navStack[navStack.length - 1];
    if (top === key) { el.removeAttribute("data-dir"); return; } // same view re-render: no push/pop
    let dir = "fwd";
    if (!inAppNav && navStack.length >= 2 && navStack[navStack.length - 2] === key) { navStack.pop(); dir = "back"; }
    else { navStack.push(key); if (navStack.length > 30) navStack.shift(); }
    el.dataset.dir = dir;
  }

  function renderRoute(route) {
    document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
    if (route.view === "member" || route.view === "raid" || route.view === "trend") {
      // Drill-downs need loaded data; until then (or if loading failed — an export
      // missing from the repo) stay put — nav views below still work.
      if (!db) return;
      if (route.view === "member") { markNavDir("member", `member:${route.name}`); openMember(route.name); }
      else if (route.view === "raid") { markNavDir("raid", `raid:${route.id}`); openRaid(route.id); }
      else { markNavDir("trend", `trend:${route.key}`); openTrend(route.key); }
      return;
    }
    document.querySelector(`.nav-link[data-target="${route.view}"]`)?.classList.add("active");
    markNavDir(route.view, route.view);
    showView(route.view);
  }

  // ← Back buttons: native history when there's an entry to go back to, else
  // Overview (e.g. a deep link opened directly in a fresh tab).
  function goBack() {
    if (window.history.length > 1) history.back();
    else navigate({ view: "overview" });
  }

  /* ---------------- sidebar navigation ---------------- */
  function setupNav() {
    document.querySelectorAll(".nav-link").forEach((link) =>
      link.addEventListener("click", () => navigate({ view: link.dataset.target }))
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

  // --- Guild Pulse (sidebar): at-a-glance numbers visible on every view.
  // Same semantics as the Overview panels it mirrors: last raid date;
  // unique attendeeUserIds in a simple 30-day window vs total accounts
  // (Most Active's "active members").
  function renderGuildPulse(users, raids) {
    const lastRaidDate = raids.reduce((m, r) => (r.date && r.date > m ? r.date : m), "");
    let last = "—";
    if (lastRaidDate) {
      const days = Math.floor((new Date() - new Date(lastRaidDate + "T00:00:00")) / 86400000);
      last = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    }
    $("#pulse-last-raid").textContent = last;

    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const c30Str = `${cutoff30.getFullYear()}-${String(cutoff30.getMonth() + 1).padStart(2, "0")}-${String(cutoff30.getDate()).padStart(2, "0")}`;
    const activeSet = new Set();
    for (const r of raids) {
      if (!r.date || r.date < c30Str) continue;
      for (const uid of r.attendeeUserIds) activeSet.add(uid);
    }
    $("#pulse-active").textContent = `${activeSet.size.toLocaleString()} / ${users.length.toLocaleString()}`;
  }

  /* ---------------- bank trend drill-downs (#/trend/<key>) ---------------- */
  // Each Guild Bank stat card links here: a larger 52-week chart of the same series
  // its sparkline shows, plus summary numbers. Balance cards reuse bankTrajectory()
  // (snapshot reconstruction — decorative trend, not ledger truth).
  const TREND_WEEKS = 52;

  function trendWeekLabel(i) {
    const d = new Date();
    d.setDate(d.getDate() - (TREND_WEEKS - 1 - i) * 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const TREND_VIEWS = {
    "bank-total": {
      title: "Guild Bank — Available DKP",
      color: "#e0a435",
      build({ weekly, bankTotal }) {
        const series = bankTrajectory(bankTotal, weekly.spentWeeks, weekly.earnedWeeks);
        return {
          series,
          fmt: (n) => Math.round(n).toLocaleString(),
          stats: [
            ["Current", bankTotal.toLocaleString()],
            ["Peak · 52w", Math.round(Math.max(...series)).toLocaleString()],
            ["Low · 52w", Math.round(Math.min(...series)).toLocaleString()],
            ["Change · 52w", fmtSignedDkp(Math.round(series[TREND_WEEKS - 1] - series[0]))],
          ],
          status: "Reconstructed from weekly spend/earnings flows (raid DKP × attendees) — manual adjustments not included.",
        };
      },
    },
    "active-dkp": {
      title: "Active Members' DKP",
      color: "#e0a435",
      build({ weekly, loot, raids, activeUserIds, totalDkpAvailable }) {
        const f = activeFlowWeeks(loot, raids, activeUserIds, TREND_WEEKS);
        const series = bankTrajectory(totalDkpAvailable, f.spend, f.earned);
        return {
          series,
          fmt: (n) => Math.round(n).toLocaleString(),
          stats: [
            ["Current · 30d active", totalDkpAvailable.toLocaleString()],
            ["Peak · 52w", Math.round(Math.max(...series)).toLocaleString()],
            ["Low · 52w", Math.round(Math.min(...series)).toLocaleString()],
            ["Change · 52w", fmtSignedDkp(Math.round(series[TREND_WEEKS - 1] - series[0]))],
          ],
          status: "Same reconstruction as the bank total, scoped to members seen on a raid in the past 30 days.",
        };
      },
    },
    items: {
      title: "Items Awarded per Week",
      color: "#4fa3e0",
      build({ weekly }) {
        const series = weekly.itemsWeeks;
        const total = series.reduce((a, b) => a + b, 0);
        return {
          series,
          fmt: (n) => String(n),
          stats: [
            ["Past week", String(series[TREND_WEEKS - 1])],
            ["Total · 52w", total.toLocaleString()],
            ["Avg per week", (total / TREND_WEEKS).toFixed(1)],
            ["Peak week", Math.max(...series).toLocaleString()],
          ],
          status: "Loot awards per week, oldest → newest.",
        };
      },
    },
    spent: {
      title: "DKP Spent per Week",
      color: "#4fa3e0",
      build({ weekly }) {
        const series = weekly.spentWeeks;
        return {
          series,
          fmt: (n) => Math.round(n).toLocaleString(),
          stats: [
            ["Past week", Math.round(series[TREND_WEEKS - 1]).toLocaleString()],
            ["Total · 52w", weekly.spentTotal.toLocaleString()],
            ["Avg per week", Math.round(weekly.spentTotal / TREND_WEEKS).toLocaleString()],
            ["Peak week", Math.round(Math.max(...series)).toLocaleString()],
          ],
          status: "Total loot DKP per week — the card shows the past-week average per member.",
        };
      },
    },
    size: {
      title: "Average Raid Size per Week",
      color: "#e0a435",
      build({ weekly }) {
        const series = weekly.counts.map((c, i) => (c ? weekly.attendeesWeeks[i] / c : 0));
        const active = series.filter((v) => v > 0);
        return {
          series,
          fmt: (n) => n.toFixed(1),
          stats: [
            ["Past week", series[TREND_WEEKS - 1].toFixed(1)],
            ["Peak week", Math.max(...series).toFixed(1)],
            ["Avg · active weeks", active.length ? (active.reduce((a, b) => a + b, 0) / active.length).toFixed(1) : "–"],
            ["Raids · 52w", weekly.windowTotal.toLocaleString()],
          ],
          status: "Attendees ÷ raids within each week — weeks without raids show 0.",
        };
      },
    },
    burn: {
      title: "DKP Spent per Raid",
      color: "#4fa3e0",
      build({ weekly }) {
        const series = weekly.counts.map((c, i) => (c ? weekly.spentWeeks[i] / c : 0));
        const active = series.filter((v) => v > 0);
        return {
          series,
          fmt: (n) => Math.round(n).toLocaleString(),
          stats: [
            ["Peak week", Math.round(Math.max(...series)).toLocaleString()],
            ["Low · active weeks", active.length ? Math.round(Math.min(...active)).toLocaleString() : "–"],
            ["Raids · 52w", weekly.windowTotal.toLocaleString()],
            ["Spend · 52w", weekly.spentTotal.toLocaleString()],
          ],
          status: "Weekly spend ÷ raid count — the card shows the 90-day average.",
        };
      },
    },
  };

  function openTrend(key) {
    const cfg = TREND_VIEWS[key];
    if (!cfg || !db) return; // unknown key or no data — parseHash already defaults to overview
    const weekly = weeklyActivity(db.raids, db.loot, TREND_WEEKS);
    // Same 30-day active set and totals as the Overview cards (string date compare).
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const c30Str = `${cutoff30.getFullYear()}-${String(cutoff30.getMonth() + 1).padStart(2, "0")}-${String(cutoff30.getDate()).padStart(2, "0")}`;
    const activeUserIds = new Set();
    for (const r of db.raids) if (r.date && r.date >= c30Str) for (const uid of r.attendeeUserIds) activeUserIds.add(uid);
    const bankTotal = db.users.reduce((s, u) => s + u.activeDkp, 0);
    const totalDkpAvailable = db.users.reduce((s, u) => s + (activeUserIds.has(u.usernameId) ? u.activeDkp : 0), 0);

    const { series, fmt, stats, status } = cfg.build({ weekly, loot: db.loot, raids: db.raids, activeUserIds, bankTotal, totalDkpAvailable });
    $("#trend-title").textContent = cfg.title;
    const max = Math.max(...series, 1);
    $("#trend-chart").innerHTML = series.map((v, i) => {
      if (!v) return `<div class="week-group"><div class="activity-bar zero" title="${trendWeekLabel(i)}: none"></div></div>`;
      const h = Math.max(4, (v / max) * 100);
      return `<div class="week-group"><div class="activity-bar" style="height:${h}%;background:${cfg.color}" title="${trendWeekLabel(i)}: ${fmt(v)}"></div></div>`;
    }).join("");
    $("#trend-status").textContent = status;
    $("#trend-stats").innerHTML = stats.map(([l, v]) => `<div class="stat-card"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`).join("");
    showView("trend");
  }

  function renderOverview(users, loot, items, raids, roster, transactions) {
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

    animateCount($("#stat-total-dkp"), totalDkpAvailable);
    animateCount($("#stat-items-awarded"), itemsLastWeek);
    animateCount($("#stat-avg-spent-week"), avgSpentWeek != null ? Math.round(avgSpentWeek) : null);
    animateCount($("#stat-avg-raid-size"), avgRaidSize != null ? Math.round(avgRaidSize) : null);

    // --- Guild Bank: total available DKP (all members) + 90-day burn per raid.
    const cutoff90 = new Date();
    cutoff90.setDate(cutoff90.getDate() - 90);
    const c90Str = `${cutoff90.getFullYear()}-${String(cutoff90.getMonth() + 1).padStart(2, "0")}-${String(cutoff90.getDate()).padStart(2, "0")}`;
    let spend90 = 0;
    for (const l of loot) if (l.date && l.date >= c90Str) spend90 += l.dkpSpent;
    let raids90 = 0;
    for (const r of raids) if (r.date && r.date >= c90Str) raids90++;
    const bankTotal = users.reduce((s, u) => s + u.activeDkp, 0);
    const burnPerRaid = raids90 ? spend90 / raids90 : null;
    animateCount($("#bank-total"), bankTotal);
    $("#bank-burn").textContent = burnPerRaid != null ? Math.round(burnPerRaid).toLocaleString() : "–";
    // Days since the last dated raid (relative to today — a stale export simply reads larger;
    // the footer's "Data through" line tells officers how fresh the export is).
    const lastRaidDate = raids.reduce((m, r) => (r.date && r.date > m ? r.date : m), "");
    let lastRaidPrefix = "";
    if (lastRaidDate) {
      const days = Math.floor((new Date() - new Date(lastRaidDate + "T00:00:00")) / 86400000);
      lastRaidPrefix = `Last raid ${days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`} · `;
    }
    $("#bank-status").textContent = raids90
      ? `${lastRaidPrefix}${raids90} raid${raids90 === 1 ? "" : "s"} · ${spend90.toLocaleString()} DKP spent in the past 90 days`
      : lastRaidDate
        ? `${lastRaidPrefix}No raids recorded in the past 90 days.`
        : "No raids recorded.";
    const earnedAll = users.reduce((s, u) => s + u.earned, 0);
    const spentAll = users.reduce((s, u) => s + u.spent, 0);
    const netAll = earnedAll - spentAll;
    $("#bank-flow").innerHTML = `All-time: earned ${earnedAll.toLocaleString()} · spent ${spentAll.toLocaleString()} · <span class="${netAll >= 0 ? "dkp-positive" : "net-negative"}">net ${netAll > 0 ? "+" : ""}${netAll.toLocaleString()}</span>`;

    // Insight panels: activity chart, recent raids, top spenders, biggest spends, class mix, joiners, raider trend
    // Weekly buckets (oldest → newest) shared by the Guild Activity chart and the
    // stat-card sparklines so both read from one source of truth.
    const weekly = weeklyActivity(raids, loot);
    // Sparklines: every bank card carries a 12-week series (oldest → newest).
    // Spent per week (blue, matches bar-spent) and avg raid size per week (gold)
    // come straight from the shared weekly buckets; items per week and burn per
    // raid are derived from them. The two "bank balance" cards have no history in
    // the exports (users.json is a snapshot), so their lines use bankTrajectory()
    // — decorative trend only, manual adjustments not included. Each card links to
    // #/trend/<key> for the 52-week version of the same series (see openTrend).
    $("#spark-spent").innerHTML = sparkline(weekly.spentWeeks, "#4fa3e0");
    const sizePerWeek = weekly.counts.map((c, i) => (c ? weekly.attendeesWeeks[i] / c : 0));
    $("#spark-size").innerHTML = sparkline(sizePerWeek, "#e0a435");
    $("#spark-items").innerHTML = sparkline(weekly.itemsWeeks, "#4fa3e0");
    const burnPerWeek = weekly.counts.map((c, i) => (c ? weekly.spentWeeks[i] / c : 0));
    $("#spark-burn").innerHTML = sparkline(burnPerWeek, "#4fa3e0");
    $("#spark-bank").innerHTML = sparkline(
      bankTrajectory(bankTotal, weekly.spentWeeks, weekly.earnedWeeks), "#e0a435");

    // Same walk scoped to the 30d-active set for the Active DKP card.
    const activeFlows = activeFlowWeeks(loot, raids, activeUserIds, ACTIVITY_WEEKS);
    $("#spark-active-dkp").innerHTML = sparkline(
      bankTrajectory(totalDkpAvailable, activeFlows.spend, activeFlows.earned), "#e0a435");

    renderOverviewPanels(users, loot, items, raids, roster, transactions, weekly);

    // Sidebar guild pulse mirrors these numbers on every view.
    renderGuildPulse(users, raids);
  }

  // Weekly activity buckets, oldest → newest, over the last ACTIVITY_WEEKS weeks.
  // Shared by the Guild Activity chart and the stat-card sparklines (one source of truth).
  function weeklyActivity(raids, loot, weeks = ACTIVITY_WEEKS) {
    const now = new Date();
    const daysAgoOf = (dateStr) => Math.floor((now - new Date(dateStr + "T00:00:00")) / 86400000);
    const counts = new Array(weeks).fill(0);
    const spentWeeks = new Array(weeks).fill(0);
    const attendeesWeeks = new Array(weeks).fill(0);
    const itemsWeeks = new Array(weeks).fill(0);
    const earnedWeeks = new Array(weeks).fill(0);
    let windowTotal = 0, spentTotal = 0;
    for (const r of raids) {
      if (!r.date) continue;
      const d = daysAgoOf(r.date);
      if (d < 0 || d >= weeks * 7) continue;
      const w = weeks - 1 - Math.floor(d / 7);
      counts[w]++;
      attendeesWeeks[w] += r.attendees.length;
      earnedWeeks[w] += (r.dkpValue || 0) * (r.attendeeUserIds ? r.attendeeUserIds.length : 0);
      windowTotal++;
    }
    for (const l of loot) {
      if (!l.date) continue; // undated awards can't be bucketed
      const d = daysAgoOf(l.date);
      if (d < 0 || d >= weeks * 7) continue;
      const w = weeks - 1 - Math.floor(d / 7);
      spentWeeks[w] += l.dkpSpent;
      itemsWeeks[w]++;
      spentTotal += l.dkpSpent;
    }
    return { counts, spentWeeks, attendeesWeeks, itemsWeeks, earnedWeeks, windowTotal, spentTotal };
  }

  // Reconstructed balance trajectory (oldest → newest): walk backwards from today's
  // total, adding back spend and subtracting earnings for each later week. Exports
  // are snapshots with no historical balances; manual adjustments aren't included —
  // decorative trend only. The newest point always equals the current total.
  function bankTrajectory(current, spendWeeks, earnedWeeks) {
    const n = spendWeeks.length;
    let accSpend = 0, accEarned = 0;
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      accSpend += spendWeeks[i];
      accEarned += earnedWeeks[i];
      out[i] = Math.max(0, current + accSpend - accEarned);
    }
    return out;
  }

  // Weekly spend/earnings flows scoped to a set of user ids (Active DKP card).
  function activeFlowWeeks(loot, raids, userIds, weeks) {
    const now = new Date();
    const weekIdxOf = (dateStr) => {
      const d = Math.floor((now - new Date(dateStr + "T00:00:00")) / 86400000);
      return d < 0 || d >= weeks * 7 ? -1 : weeks - 1 - Math.floor(d / 7);
    };
    const spend = new Array(weeks).fill(0);
    const earned = new Array(weeks).fill(0);
    for (const l of loot) {
      if (!l.date || !userIds.has(l.user)) continue;
      const w = weekIdxOf(l.date);
      if (w < 0) continue;
      spend[w] += l.dkpSpent;
    }
    for (const r of raids) {
      if (!r.date || !r.dkpValue || !r.attendeeUserIds) continue;
      const w = weekIdxOf(r.date);
      if (w < 0) continue;
      let n = 0;
      for (const uid of r.attendeeUserIds) if (userIds.has(uid)) n++;
      earned[w] += r.dkpValue * n;
    }
    return { spend, earned };
  }

  function renderOverviewPanels(users, loot, items, raids, roster, transactions, weekly) {
    const now = new Date();
    const daysAgoOf = (dateStr) => Math.floor((now - new Date(dateStr + "T00:00:00")) / 86400000);

    // --- Guild activity: raids + DKP spent per week over the last ACTIVITY_WEEKS weeks (7-day buckets from today)
    const counts = weekly.counts;
    const spentWeeks = weekly.spentWeeks;
    const windowTotal = weekly.windowTotal;
    const spentTotal = weekly.spentTotal;
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

    // --- Raid activity heatmap: one cell per day for the past 52 weeks (GitHub-style).
    // The grid is date-driven (always 364 cells); data only colors them.
    const HEATMAP_DAYS = 7 * 52;
    const raidsByDay = new Map();
    let windowRaids = 0;
    for (const r of raids) {
      if (!r.date) continue;
      raidsByDay.set(r.date, (raidsByDay.get(r.date) || 0) + 1);
    }
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hmEnd = new Date(now);
    const hmStart = new Date(hmEnd);
    hmStart.setDate(hmStart.getDate() - (HEATMAP_DAYS - 1));
    // Pad the first column so it starts on a Sunday (today lands bottom-right).
    const pad = (hmStart.getDay() + 6) % 7;
    let cells = Array.from({ length: pad }, () => `<i class="hm-cell hm-empty"></i>`).join("");
    let activeDays = 0, peakN = 0, peakDate = "";
    for (let d = new Date(hmStart); d <= hmEnd; d.setDate(d.getDate() + 1)) {
      const iso = isoOf(d);
      const n = raidsByDay.get(iso) || 0;
      if (n > 0) {
        activeDays++;
        windowRaids += n;
        if (n > peakN) { peakN = n; peakDate = iso; }
      }
      cells += `<i class="hm-cell hm-l${Math.min(n, 3)}" title="${iso}: ${n} raid${n === 1 ? "" : "s"}"></i>`;
    }
    $("#raid-heatmap").innerHTML = cells;
    // Summary chips sit right-aligned in the panel head (was a status line below the title).
    $("#heatmap-summary").innerHTML = peakN
      ? `<span class="hm-chip">${windowRaids.toLocaleString()} raids</span>` +
        `<span class="hm-chip">${activeDays.toLocaleString()} active days</span>` +
        `<span class="hm-chip">busiest ${peakDate} · ${peakN}</span>`
      : `<span class="hm-chip hm-muted">no raids in the past year</span>`;

    // --- Recent raids (newest first)
    // `|| ""` guards undated raids (same defensive convention as renderRaidsPage).
    const recentRaids = [...raids].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, RECENT_RAIDS_SHOWN);
    // Items awarded per raid, joined on the exact raid id (raid names repeat over time).
    const lootByRaidId = new Map();
    for (const l of loot) if (l.raidId) lootByRaidId.set(l.raidId, (lootByRaidId.get(l.raidId) || 0) + 1);
    $("#recent-raids-table tbody").innerHTML = recentRaids.map((r) => `
      <tr>
        <td>${esc(r.date || "")}</td>
        <td><a href="#/raid/${encodeURIComponent(r.id)}" class="raid-link">${esc(r.name || r.id)}</a></td>
        <td class="num">${r.attendees.length}</td>
        <td class="num">${lootByRaidId.get(r.id) || 0}</td>
      </tr>`).join("");
    $("#recent-raids-table").hidden = recentRaids.length === 0;
    $("#recent-raids-status").textContent = recentRaids.length
      ? `Last ${recentRaids.length} of ${raids.length.toLocaleString()} raids`
      : "No raids recorded.";

    // --- Recent rewards (newest first, undated last). Optional file — may be empty.
    const RECENT_TX_SHOWN = 5;
    const txSorted = [...transactions].sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    // Latest N — but never cut a day in half: any date inside the top-N that has more than
    // N rewards overall shows all of its rows (payout days arrive as bursts).
    const txDayCounts = new Map();
    for (const t of transactions) txDayCounts.set(t.date, (txDayCounts.get(t.date) || 0) + 1);
    const keepDates = new Set(txSorted.slice(0, RECENT_TX_SHOWN).map((t) => t.date));
    const recentTx = [];
    for (const t of txSorted) {
      if (!keepDates.has(t.date)) break; // sorted desc — past the top-N dates we're done
      if ((txDayCounts.get(t.date) || 0) > RECENT_TX_SHOWN || recentTx.length < RECENT_TX_SHOWN) recentTx.push(t);
    }
    $("#recent-transactions-table tbody").innerHTML = recentTx.map((t) => `
      <tr>
        <td>${t.date ? esc(t.date) : "—"}</td>
        <td>${t.username
          ? `<a href="#/member/${encodeURIComponent(t.username)}" class="member-link">${esc(t.username)}</a>`
          : "—"}</td>
        <td>${esc(t.type)}</td>
        <td>${esc(t.reason)}</td>
        <td class="${signedDkpClass(t.amount)}">${fmtSignedDkp(t.amount)}</td>
      </tr>`).join("");
    $("#recent-transactions-table").hidden = recentTx.length === 0;
    $("#recent-transactions-status").textContent = transactions.length
      ? `Last ${recentTx.length} of ${transactions.length.toLocaleString()} rewards · newest first`
      : "No rewards recorded.";

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
        <a href="#/member/${encodeURIComponent(name)}" class="member-link rank-name">${esc(name)}</a>
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
        <a href="#/member/${encodeURIComponent(name)}" class="member-link rank-name">${esc(name)}</a>
        <span class="rank-val">${n} raid${n === 1 ? "" : "s"}</span>
      </li>`;
    }).join("");
    const coreCount = [...attendance.values()].filter((n) => n >= CORE_RAIDS_MIN).length;
    // Guild-wide avg 30d attendance — same semantics as Standings' 30D column: per-member
    // attended/total over the window clamped to join date, presence = username_id OR character name.
    let avgAttPct = null;
    if (attendance.size) {
      const joinedByMember = new Map();
      for (const row of roster) {
        for (const d of [row.applied, row.memberSince]) {
          if (!d) continue;
          const prev = joinedByMember.get(row.member);
          if (!prev || d < prev) joinedByMember.set(row.member, d);
        }
      }
      const uidOfUser = new Map(users.map((u) => [u.username, u.usernameId]));
      const charNameToUid = new Map();
      for (const row of roster) {
        const uid = uidOfUser.get(row.member);
        if (uid && !charNameToUid.has(row.character.toLowerCase())) charNameToUid.set(row.character.toLowerCase(), uid);
      }
      const attCounts = new Map(); // usernameId -> raids attended in the 30d window
      for (const r of raids) {
        if (!r.date || r.date < cutoff30Str) continue;
        const credited = new Set(r.attendeeUserIds);
        for (const name of r.attendees) {
          const uid = charNameToUid.get(name.toLowerCase());
          if (uid) credited.add(uid);
        }
        for (const uid of credited) attCounts.set(uid, (attCounts.get(uid) || 0) + 1);
      }
      // Sorted raid dates -> O(log n) "total raids since X" lookups.
      const raidDatesAll = raids.map((r) => r.date).filter(Boolean).sort();
      const totalSince = (start) => {
        let lo = 0, hi = raidDatesAll.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (raidDatesAll[mid] < start) lo = mid + 1; else hi = mid; }
        return raidDatesAll.length - lo;
      };
      let attSum = 0, attN = 0;
      for (const u of users) {
        const jo = joinedByMember.get(u.username) || "";
        const total = totalSince(jo > cutoff30Str ? jo : cutoff30Str);
        if (!total) continue; // no raid opportunities in their clamped window
        attSum += (attCounts.get(u.usernameId) || 0) / total;
        attN++;
      }
      avgAttPct = attN ? Math.round((attSum / attN) * 100) : null;
    }
    const attPrefix = avgAttPct != null ? `Avg 30d attendance ${avgAttPct}% · ` : "";
    $("#most-active-status").textContent = attendance.size
      ? `${attPrefix}${coreCount.toLocaleString()} core raiders (${CORE_RAIDS_MIN}+ raids) of ${attendance.size.toLocaleString()} active members`
      : "No raids in the past 30 days.";

    // --- Declining attendance (60d → 30d) & returning raiders — pure helpers in js/metrics.js
    const todayStr = isoDate(new Date());
    const attMembers = Metrics.attendanceByMember(raids, roster, users);
    const declining = Metrics.findDecliningMembers(attMembers, { asOf: todayStr });
    $("#declining-status").textContent = declining.length
      ? `${declining.length} member${declining.length === 1 ? "" : "s"} went quiet (4+ raids in days 60–31, ≤1 since)`
      : "No sharp attendance drops in the past 60 days.";
    $("#declining-list").innerHTML = declining.map((m, i) => `
      <li>
        <span class="rank-num">${i + 1}</span>
        <a href="#/member/${encodeURIComponent(m.member)}" class="member-link rank-name">${esc(m.member)}</a>
        <span class="rank-val">${m.prior} → ${m.recent}</span>
      </li>`).join("");

    const returning = Metrics.findReturningMembers(attMembers, { asOf: todayStr });
    $("#returning-status").textContent = returning.length
      ? `${returning.length} member${returning.length === 1 ? "" : "s"} back after a gap of 45+ days`
      : "No returns from long absences in the past 30 days.";
    $("#returning-list").innerHTML = returning.map((m, i) => `
      <li>
        <span class="rank-num">${i + 1}</span>
        <a href="#/member/${encodeURIComponent(m.member)}" class="member-link rank-name">${esc(m.member)}</a>
        <span class="rank-sub">back ${isoDate(m.returnDate)}</span>
        <span class="rank-val">${m.gapDays}d away</span>
      </li>`).join("");

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
        <a href="#/member/${encodeURIComponent(name)}" class="member-link rank-name">${esc(name)}</a>
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
    renderClassDkp(users, roster, counts);
    applyStandingsSort();
    renderStandingsPage(1);
  }

  // Top-5-per-class leaderboard for active members (≥1 attended raid in the clamped 30-day window,
  // same semantics as the table's 30D column). Main characters only (Main/Alt === "main").
  // Two metrics via the panel-head toggle: Available DKP (account balance) — default — and
  // Spent DKP (all-time loot spend); switching re-sorts every class list by that metric.
  let classDkpMode = "available";
  let classDkpData = null; // { byClass: Map cls -> [{character, available, spent}], activeCount }

  function renderClassDkp(users, roster, counts) {
    const active = new Set();
    for (const u of users) if ((counts.get(u.usernameId) || [])[0] > 0) active.add(u.username);
    const byMember = new Map(users.map((u) => [u.username, { available: u.activeDkp, spent: u.spent }]));
    const byClass = new Map(); // cls -> [{ character, available, spent }]
    for (const row of roster) {
      if (!row.cls || !active.has(row.member)) continue;
      if (String(row.mainAlt || "").toLowerCase() !== "main") continue; // mains only
      const v = byMember.get(row.member) ?? { available: 0, spent: 0 };
      const list = byClass.get(row.cls) || [];
      list.push({ character: row.character, ...v });
      byClass.set(row.cls, list);
    }
    classDkpData = { byClass, activeCount: active.size };
    renderClassDkpGrid();
  }

  function renderClassDkpGrid() {
    const { byClass, activeCount } = classDkpData || { byClass: new Map(), activeCount: 0 };
    const key = classDkpMode === "spent" ? "spent" : "available";
    const classes = [...byClass.entries()]
      .map(([cls, chars]) => {
        const sorted = [...chars].sort((a, b) => (b[key] - a[key]) || a.character.localeCompare(b.character));
        return [cls, sorted.slice(0, 5), chars.length];
      })
      .sort((a, b) => a[0].localeCompare(b[0])); // alphabetical by class

    const totalChars = [...byClass.values()].reduce((s, c) => s + c.length, 0);
    $("#class-dkp-status").textContent = classes.length
      ? `Top 5 per class · ${totalChars.toLocaleString()} characters from ${activeCount.toLocaleString()} active members (raids in past 30 days) · sorted by ${key === "spent" ? "Spent" : "Available"} DKP`
      : "No members seen on raids in the past 30 days.";
    $("#class-dkp-grid").innerHTML = classes.map(([cls, top, total]) => `
      <div class="class-dkp-card">
        <div class="class-dkp-head"><span>${esc(cls)}</span><span class="class-dkp-count">${total} char${total === 1 ? "" : "s"}</span></div>
        <ol class="class-dkp-list">
          ${top.map((c) => `<li title="${esc(c.character)}"><span class="cdk-char">${esc(c.character)}</span><span class="cdk-val">${c[key].toLocaleString()}</span></li>`).join("")}
        </ol>
      </div>`).join("");
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
        <td><a href="#/member/${encodeURIComponent(u.username)}" class="member-link">${esc(u.username)}</a></td>
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
        <td>${l.raidId && l.raid
          ? `<a href="#/raid/${encodeURIComponent(l.raidId)}" class="raid-link">${esc(l.raid)}</a>`
          : (l.raid ? esc(l.raid) : "—")}</td>
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
  let rosterState = { search: "", rank: "", mainAlt: "", cls: "", sortKey: "member", sortDir: 1, hideInactive: true };

  // Members seen on at least one raid within 30 days of the newest raid date (data-relative,
  // so a stale export still describes the guild as of its latest activity).
  let rosterActiveMembers = new Set();

  function computeRosterActiveMembers(raids, roster, users) {
    const dated = raids.filter((r) => r.date);
    if (!dated.length) return new Set();
    const latest = dated.reduce((m, r) => (r.date > m ? r.date : m), dated[0].date);
    const ref = new Date(latest + "T00:00:00Z");
    ref.setUTCDate(ref.getUTCDate() - 30);
    const cutoff = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}-${String(ref.getUTCDate()).padStart(2, "0")}`;
    const usernameById = new Map(users.map((u) => [u.usernameId, u.username]));
    const memberByChar = new Map(roster.filter((r) => r.character).map((r) => [r.character, r.member]));
    const active = new Set();
    for (const r of raids) {
      if (!r.date || r.date < cutoff) continue;
      for (const uid of r.attendeeUserIds) {
        const m = usernameById.get(uid);
        if (m) active.add(m);
      }
      for (const name of r.attendees) {
        const m = memberByChar.get(name);
        if (m) active.add(m);
      }
    }
    return active;
  }

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
      if (s.hideInactive && !rosterActiveMembers.has(r.member)) return false;
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
        <td><a href="#/member/${encodeURIComponent(r.member)}" class="member-link">${esc(r.member)}</a></td>
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

  /** Shared stats for a member by name — single source of truth for the DKP / attendance /
   *  join-date semantics, used by both Member Detail (openMember) and the hover card.
   *  Returns null-ish empties (user=null, chars=[]) when the name is in neither file. */
  function memberStats(name) {
    const m = name.toLowerCase();
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
    const attendedRaids = []; // full history for the Raid History table
    const winTotal = Object.fromEntries(windows.map(([k]) => [k, 0]));
    const winAttended = Object.fromEntries(windows.map(([k]) => [k, 0]));
    for (const r of db.raids) {
      const present = isPresent(r); // computed once per raid (used below + for the lifetime count)
      if (present) { raidsAttended++; attendedRaids.push(r); }
      if (!r.date) continue; // undated raids can't be placed in a window
      for (const [key, cutoff] of windows) {
        if (cutoff && r.date >= cutoff) {
          winTotal[key]++;
          if (present) winAttended[key]++;
        }
      }
    }

    // Roster Rank: hide the default ("member"), surface officer / guild leader / inactive / applicant / former.
    const rank = chars.map((c) => c.rank).find(Boolean) || "";

    return { user, chars, charNames, userIds, available, earned, spent, raidsAttended, attendedRaids,
      winTotal, winAttended, joinedOn, raidsSinceJoin: joinedOn ? winTotal.lifetime : null, rank };
  }

  const fmtPct = (a, t) => (t ? `${Math.round((a / t) * 100)}%` : "\u2013");

  function openMember(name) {
    if (!db) return;
    const s = memberStats(name);
    const { user, chars, charNames, userIds, available, earned, spent, raidsAttended,
      attendedRaids, winTotal, winAttended, joinedOn, raidsSinceJoin, rank } = s;
    const m = name.toLowerCase(); // legacy tx fallback match (rows without username_id)

    // Unknown deep link (e.g. a stale shared URL): show an explicit not-found state
    // instead of zeros that would look like real data.
    if (!user && chars.length === 0) {
      $("#member-name").textContent = name;
      $("#member-rank").hidden = true;
      for (const id of ["member-available", "member-earned", "member-spent"]) $(`#${id}`).textContent = "\u2013";
      for (const id of ["member-att-30", "member-att-60", "member-att-90", "member-att-lifetime"]) $(`#${id}`).textContent = "\u2013";
      $("#member-raids-attended").textContent = "\u2013";
      $("#member-raids-since").textContent = "\u2013";
      $("#member-raids-since-label").textContent = "";
      $("#member-characters").innerHTML = `<span class="panel-status error">No member or roster character named \u201c${esc(name)}\u201d was found in the data.</span>`;
      memberLootSorted = [];
      renderMemberLootPage(1);
      memberRaidsSorted = [];
      renderMemberRaidsPage(1);
      memberTxSorted = [];
      renderMemberTxPage(1);
      showView("member");
      return;
    }

    $("#member-name").textContent = name;
    // Roster Rank: hide the default ("member"), surface officer / guild leader / inactive / applicant / former.
    $("#member-rank").hidden = !rank || rank.toLowerCase() === "member";
    $("#member-rank").textContent = rank;
    $("#member-available").textContent = available.toLocaleString();
    $("#member-earned").textContent = earned.toLocaleString();
    $("#member-spent").textContent = spent.toLocaleString();
    $("#member-raids-attended").textContent = raidsAttended.toLocaleString();
    $("#member-raids-since").textContent = raidsSinceJoin != null ? raidsSinceJoin.toLocaleString() : "–";
    $("#member-raids-since-label").textContent = joinedOn ? `since ${joinedOn}` : "(no join date)";
    $("#member-att-30").textContent = fmtPct(winAttended["30"], winTotal["30"]);
    $("#member-att-60").textContent = fmtPct(winAttended["60"], winTotal["60"]);
    $("#member-att-90").textContent = fmtPct(winAttended["90"], winTotal["90"]);
    $("#member-att-lifetime").textContent = fmtPct(winAttended.lifetime, winTotal.lifetime);
    $("#member-att-lifetime-label").textContent = joinedOn ? `Lifetime (since ${joinedOn})` : "Lifetime";

    $("#member-characters").innerHTML = chars.length
      ? chars.map((c) =>
          `<span class="member-char">${quarmyLink(c.character)} · ${esc(c.cls)} (${c.level}) · ${esc(c.mainAlt || "—")}</span>`
        ).join("")
      : "<span class=\"panel-status\">No roster characters found.</span>";

    // Raid History: newest first, undated raids last (same ordering as the loot table).
    memberRaidsSorted = attendedRaids.slice().sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    renderMemberRaidsPage(1);

    memberLootSorted = db.loot.filter((l) => charNames.has(String(l.player).toLowerCase()));
    memberLootSorted.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    renderMemberLootPage(1);

    // Transaction history: account-level adjustments. Match by username_id when the
    // member is in users.json; fall back to case-insensitive name (roster-only members,
    // or legacy rows without a username_id).
    memberTxSorted = db.transactions.filter((t) =>
      user && t.usernameId ? userIds.has(t.usernameId) : t.username.toLowerCase() === m
    ).sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    renderMemberTxPage(1);

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
        <td>${l.raidId
          ? `<a href="#/raid/${encodeURIComponent(l.raidId)}" class="raid-link" title="${esc(l.raid)}">${esc(l.raid)}</a>`
          : (l.raid ? esc(l.raid) : "—")}</td>
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

  const MEMBER_RAIDS_PAGE_SIZE = 10;
  let memberRaidsSorted = [];
  let memberRaidsPage = 1;

  function renderMemberRaidsPage(page) {
    const totalPages = Math.max(1, Math.ceil(memberRaidsSorted.length / MEMBER_RAIDS_PAGE_SIZE));
    memberRaidsPage = Math.min(Math.max(1, page), totalPages);
    const start = (memberRaidsPage - 1) * MEMBER_RAIDS_PAGE_SIZE;
    const rows = memberRaidsSorted.slice(start, start + MEMBER_RAIDS_PAGE_SIZE);

    $("#member-raids-table tbody").innerHTML = rows.map((r) => `
      <tr>
        <td>${r.date ? esc(r.date) : "—"}</td>
        <td>${r.id && r.name
          ? `<a href="#/raid/${encodeURIComponent(r.id)}" class="raid-link">${esc(r.name)}</a>`
          : (r.name ? esc(r.name) : "—")}</td>
        <td class="num">${r.dkpValue.toLocaleString()}</td>
      </tr>`).join("");

    $("#member-raids-table").hidden = rows.length === 0;
    $("#member-raids-status").textContent = memberRaidsSorted.length
      ? `${memberRaidsSorted.length.toLocaleString()} raids attended · newest first · ` +
        (rows.length
          ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${memberRaidsPage} of ${totalPages.toLocaleString()})`
          : "no raids")
      : "No raid attendance found.";

    renderPager("member-raids-pager", memberRaidsPage, totalPages);
  }

  const MEMBER_TX_PAGE_SIZE = 10;
  let memberTxSorted = [];
  let memberTxPage = 1;

  function renderMemberTxPage(page) {
    const totalPages = Math.max(1, Math.ceil(memberTxSorted.length / MEMBER_TX_PAGE_SIZE));
    memberTxPage = Math.min(Math.max(1, page), totalPages);
    const start = (memberTxPage - 1) * MEMBER_TX_PAGE_SIZE;
    const rows = memberTxSorted.slice(start, start + MEMBER_TX_PAGE_SIZE);

    $("#member-tx-table tbody").innerHTML = rows.map((t) => `
      <tr>
        <td>${t.date ? esc(t.date) : "—"}</td>
        <td>${esc(t.type)}</td>
        <td>${esc(t.reason)}</td>
        <td class="${signedDkpClass(t.amount)}">${fmtSignedDkp(t.amount)}</td>
      </tr>`).join("");

    $("#member-tx-table").hidden = rows.length === 0;
    $("#member-tx-status").textContent = memberTxSorted.length
      ? `${memberTxSorted.length.toLocaleString()} rewards · newest first · ` +
        (rows.length
          ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${memberTxPage} of ${totalPages.toLocaleString()})`
          : "no rewards")
      : "No rewards found.";

    renderPager("member-tx-pager", memberTxPage, totalPages);
  }

  /* ---------------- raid detail ---------------- */
  const RAID_LOOT_PAGE_SIZE = 10;
  let raidLootSorted = [];
  let raidLootPage = 1;
  function openRaid(raidId) {
    if (!db || !raidId) return;
    const r = db.raids.find((x) => x.id === raidId);
    // Unknown deep link: show an explicit not-found state instead of stale content.
    if (!r) {
      $("#raid-name").textContent = "Unknown raid";
      $("#raid-date").hidden = true;
      for (const id of ["raid-attendees", "raid-items", "raid-dkp-spent"]) $(`#${id}`).textContent = "\u2013";
      $("#raid-attendee-list").innerHTML = "";
      const notFoundStatus = $("#raid-attendees-status");
      notFoundStatus.classList.add("error");
      notFoundStatus.textContent = `No raid with id \u201c${esc(raidId)}\u201d was found in the data.`;
      raidLootSorted = [];
      renderRaidLootPage(1);
      showView("raid");
      return;
    }

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
          <a href="#/member/${encodeURIComponent(m)}" class="member-link">${esc(m)}</a>${chars.length > 1 ? `<span class="chip-chars">${chars.map((c) => quarmyLink(c)).join(", ")}</span>` : ""}
        </li>`),
      ...loose.sort((a, b) => String(a).localeCompare(String(b))).map((c) => `
        <li class="loose"><span class="chip-name">${quarmyLink(c)}</span></li>`),
    ];
    $("#raid-attendee-list").innerHTML = attendeeRows.join("");
    const attendeesStatus = $("#raid-attendees-status");
    attendeesStatus.classList.remove("error"); // clear a not-found state from an earlier deep link
    attendeesStatus.textContent = r.attendees.length
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
        <td>${owner ? `<a href="#/member/${encodeURIComponent(owner)}" class="member-link">${esc(owner)}</a>` : "\u2014"}</td>
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
  const RAID_PAGE_SIZE = 25;
  let raidsSorted = [];
  let raidsFiltered = [];
  let raidSearch = "";
  let raidPage = 1;

  function renderRaids(raids) {
    raidsSorted = [...raids].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    applyRaidFilter();
    renderRaidsPage(1);
  }

  function applyRaidFilter() {
    const q = raidSearch.trim().toLowerCase();
    raidsFiltered = q
      ? raidsSorted.filter((r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.date && r.date.includes(q)) ||
          r.attendees.some((a) => a.toLowerCase().includes(q)))
      : raidsSorted;
  }

  function renderRaidsPage(page) {
    const totalPages = Math.max(1, Math.ceil(raidsFiltered.length / RAID_PAGE_SIZE));
    raidPage = Math.min(Math.max(1, page), totalPages);
    const start = (raidPage - 1) * RAID_PAGE_SIZE;
    const rows = raidsFiltered.slice(start, start + RAID_PAGE_SIZE);

    // Attendees are collapsed to the first three names (+N more); the full list stays in a
    // title tooltip and in Raid Detail — the old per-row text wall made this table unreadable.
    $("#raids-table tbody").innerHTML = rows.map((r) => {
      const shown = r.attendees.slice(0, 3).map(esc).join(", ");
      const extra = r.attendees.length - 3;
      return `
      <tr>
        <td>${esc(r.date || "—")}</td>
        <td><a href="#/raid/${encodeURIComponent(r.id)}" class="raid-link">${esc(r.name)}</a></td>
        <td class="num">${r.dkpValue}</td>
        <td class="raid-attendees" title="${r.attendees.map(esc).join(", ")}">${shown}${extra > 0 ? ` <span class="attendees-more">+${extra} more</span>` : ""}</td>
        <td class="num">${r.attendees.length}</td>
      </tr>`;
    }).join("");

    $("#raids-table").hidden = rows.length === 0;
    const searched = raidSearch.trim() ? ` · matching “${raidSearch.trim()}”` : "";
    $("#raids-status").textContent = `${raidsFiltered.length.toLocaleString()} raids · newest first${searched} · ` +
      (rows.length ? `showing ${start + 1}–${(start + rows.length).toLocaleString()} (page ${raidPage} of ${totalPages.toLocaleString()})` : "no matches");

    renderPager("raids-pager", raidPage, totalPages);
  }


  /* ---------------- command palette (Ctrl+K / "/" / topbar button) ---------------- */
  let paletteIndex = null; // { members, chars, items, raids } — built once from db
  let paletteFlat = [];    // flat list of currently rendered rows (keyboard nav)
  let paletteSel = 0;

  const PALETTE_VIEWS = [
    { kind: "view", value: "overview", label: "Overview" },
    { kind: "view", value: "standings", label: "Raider Standings" },
    { kind: "view", value: "loot", label: "Loot History" },
    { kind: "view", value: "roster", label: "Roster" },
    { kind: "view", value: "raids", label: "Raid History" },
  ];

  function buildPaletteIndex() {
    const members = db.users.map((u) => ({ kind: "member", value: u.username, label: u.username, sub: "Member" }));
    const chars = db.roster.map((r) => ({ kind: "char", value: r.member, label: r.character, sub: `${r.cls} · ${r.member}` }));
    // Items that actually appear in loot (original casing), deduped case-insensitively.
    const seen = new Set();
    const items = [];
    for (const l of db.loot) {
      if (!l.item) continue;
      const k = l.item.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ kind: "item", value: k, label: l.item, sub: "Item → pqdi.cc" });
    }
    const raids = db.raids.map((r) => ({ kind: "raid", value: r.id, label: r.name || r.id, sub: `Raid · ${r.date || "undated"}` }));
    paletteIndex = { members, chars, items, raids };
  }

  function scoreMatch(q, text) {
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return null;
    return (idx === 0 ? 200 : 100) - Math.min(idx, 40); // earlier match wins
  }

  function paletteSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) return [{ title: "Views", rows: PALETTE_VIEWS }];
    const groups = [];
    const searchGroup = (title, list, cap) => {
      const hits = [];
      for (const row of list) {
        const s = scoreMatch(q, row.label);
        if (s != null) hits.push({ ...row, _score: s });
      }
      hits.sort((a, b) => b._score - a._score || a.label.localeCompare(b.label));
      if (hits.length) groups.push({ title, rows: hits.slice(0, cap) });
    };
    searchGroup("Members", paletteIndex.members, 4);
    searchGroup("Characters", paletteIndex.chars, 4);
    searchGroup("Raids", paletteIndex.raids, 4);
    searchGroup("Items", paletteIndex.items, 4);
    return groups;
  }

  function renderPalette(q) {
    const box = $("#palette-results");
    const groups = paletteSearch(q);
    paletteFlat = [];
    if (!groups.length) {
      box.innerHTML = `<div class="pal-empty">No matches for “${esc(q.trim())}”</div>`;
      return;
    }
    box.innerHTML = groups.map((g) => `
      <div class="pal-group">
        <div class="pal-title">${esc(g.title)}</div>
        ${g.rows.map((r) => {
          const i = paletteFlat.length;
          paletteFlat.push(r);
          return `<button type="button" class="pal-row${i === paletteSel ? " selected" : ""}" data-i="${i}">
            <span class="pal-label">${esc(r.label)}</span>
            ${r.sub ? `<span class="pal-sub">${esc(r.sub)}</span>` : ""}
          </button>`;
        }).join("")}
      </div>`).join("");
    if (paletteSel >= paletteFlat.length) paletteSel = Math.max(0, paletteFlat.length - 1);
  }

  function movePaletteSel(delta) {
    if (!paletteFlat.length) return;
    paletteSel = (paletteSel + delta + paletteFlat.length) % paletteFlat.length;
    document.querySelectorAll("#palette-results .pal-row").forEach((el, i) => el.classList.toggle("selected", i === paletteSel));
    const selEl = document.querySelector("#palette-results .pal-row.selected");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  }

  function activatePaletteRow(row) {
    closePalette();
    // Hash navigation pushes a history entry, so browser back returns to the origin view.
    if (row.kind === "member" || row.kind === "char") navigate({ view: "member", name: row.value });
    else if (row.kind === "raid") navigate({ view: "raid", id: row.value });
    else if (row.kind === "view") navigate({ view: row.value });
    else if (row.kind === "item") {
      const id = db.items.byName.get(row.value);
      if (id) window.open(`https://www.pqdi.cc/item/${id}`, "_blank", "noopener");
    }
  }

  function openPalette() {
    if (!db || !paletteIndex) return; // data not loaded yet
    $("#palette").hidden = false;
    const input = $("#palette-input");
    input.value = "";
    paletteSel = 0;
    renderPalette("");
    requestAnimationFrame(() => input.focus());
  }

  function closePalette() {
    $("#palette").hidden = true;
  }

  function setupPalette() {
    buildPaletteIndex();
    $("#palette-open").addEventListener("click", () => ($("#palette").hidden ? openPalette() : closePalette()));
    $("#palette-input").addEventListener("input", (e) => { paletteSel = 0; renderPalette(e.target.value); });
    $("#palette-results").addEventListener("click", (e) => {
      const btn = e.target.closest(".pal-row");
      if (!btn) return;
      activatePaletteRow(paletteFlat[Number(btn.dataset.i)]);
    });
    // Backdrop click closes.
    $("#palette").addEventListener("mousedown", (e) => { if (e.target === $("#palette")) closePalette(); });

    document.addEventListener("keydown", (e) => {
      const isOpen = !$("#palette").hidden;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) closePalette(); else openPalette();
        return;
      }
      if (!isOpen) {
        // "/" opens the palette unless we're typing in a field.
        const tag = (document.activeElement || {}).tagName || "";
        if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) { e.preventDefault(); openPalette(); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); movePaletteSel(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePaletteSel(-1); }
      else if (e.key === "Enter" && document.activeElement === $("#palette-input")) {
        e.preventDefault();
        const row = paletteFlat[paletteSel];
        if (row) activatePaletteRow(row);
      }
    });
  }

  /* ---------------- pqdi.cc item tooltip (hover) ---------------- */
  // Item links carry data-pqdi-id (Data.itemLink). On hover we fetch pqdi.cc's own
  // pre-rendered tooltip HTML — /get-item-tooltip/<id>, the same endpoint their site
  // uses, which is CORS-open (it echoes our Origin back) — sanitize it, absolutize its
  // relative URLs, and show it in #item-tooltip. Cached per id so repeat hovers are
  // instant; sw.js also stale-while-revalidates cross-origin GETs, so the cache
  // survives reloads. Desktop only (hover:hover + pointer:fine) — mobile keeps the
  // plain new-tab link. Offline / unknown id → fetch fails → no tooltip.
  const PQDI_BASE = "https://www.pqdi.cc";
  const tipCache = new Map(); // pqdi id -> sanitized HTML string
  let tipEl = null;
  let tipActiveLink = null;
  let tipSeq = 0; // bumped on every hide — invalidates in-flight fetches

  /** Strip anything executable from third-party tooltip HTML and absolutize its URLs. */
  function sanitizePqdiHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const drop = new Set(["script", "style", "iframe", "object", "embed", "link", "meta",
      "form", "input", "button", "select", "textarea"]);
    for (const el of [...doc.body.querySelectorAll("*")]) {
      if (drop.has(el.tagName.toLowerCase())) { el.remove(); continue; }
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on")) el.removeAttribute(attr.name);
        else if ((n === "href" || n === "src") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      }
    }
    // Relative URLs → absolute pqdi.cc (icon sprites, currency icons, /spell/ links).
    doc.querySelectorAll("img[src]").forEach((im) => { im.src = new URL(im.getAttribute("src"), PQDI_BASE).href; });
    doc.querySelectorAll("a[href]").forEach((a) => {
      a.href = new URL(a.getAttribute("href"), PQDI_BASE).href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    // Inline style sprites: url(/static/iconss/…) → absolute.
    doc.querySelectorAll("[style]").forEach((el) =>
      el.setAttribute("style", el.getAttribute("style").split("url(/").join(`url(${PQDI_BASE}/`)));
    return doc.body.innerHTML;
  }

  /** Position a fixed hover panel next to its anchor link (flip left when it would overflow). */
  function positionHoverTip(panel, link) {
    const r = link.getBoundingClientRect();
    const tw = panel.offsetWidth, th = panel.offsetHeight;
    let x = r.right + 8; // right of the link…
    if (x + tw > window.innerWidth - 8) x = Math.max(8, r.left - tw - 8); // …flip left when it would overflow
    const y = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - th - 8));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  /** Scroll behavior for a hover panel: follow its anchor as it moves; hide only when the anchor leaves the viewport. */
  const makeScrollFollow = (getState) => () => {
    const { link, panel, hide } = getState();
    if (!link || !panel || panel.hidden) return;
    const r = link.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) hide(); // anchor scrolled out of view
    else positionHoverTip(panel, link); // follow the anchor — a fixed panel would otherwise drift off it
  };

  async function showItemTip(link) {
    const id = link.dataset.pqdiId;
    if (!/^\d+$/.test(id || "")) return;
    const seq = ++tipSeq;
    tipActiveLink = link;
    tipEl.hidden = false;
    tipEl.innerHTML = '<div class="item-tip-loading">Loading…</div>';
    positionHoverTip(tipEl, link);
    let html = tipCache.get(id);
    if (!html) {
      try {
        const res = await fetch(`${PQDI_BASE}/get-item-tooltip/${id}`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = sanitizePqdiHtml(await res.text());
        tipCache.set(id, html);
      } catch (err) {
        if (seq === tipSeq && tipActiveLink === link) hideItemTip(); // unknown id / offline → no tooltip
        return;
      }
    }
    if (seq !== tipSeq || tipActiveLink !== link) return; // user moved on while fetching
    tipEl.innerHTML = html;
    positionHoverTip(tipEl, link); // reposition with the final size
  }

  function hideItemTip() {
    tipSeq++; // invalidate any in-flight fetch
    tipActiveLink = null;
    if (tipEl) { tipEl.hidden = true; tipEl.innerHTML = ""; }
  }

  function setupItemTooltips() {
    tipEl = $("#item-tooltip");
    if (!tipEl || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return; // desktop only
    document.addEventListener("mouseover", (e) => {
      const link = e.target.closest ? e.target.closest("[data-pqdi-id]") : null;
      if (!link || link === tipActiveLink) return;
      hideItemTip();
      hideMemberTip(); // at most one hover panel on screen
      showItemTip(link);
    });
    document.addEventListener("mouseout", (e) => {
      if (!tipActiveLink) return;
      const stays = e.relatedTarget && tipActiveLink.contains(e.relatedTarget);
      if (!stays) hideItemTip(); // entering another item link re-shows via its mouseover
    });
    // Keyboard parity: Tab to a link shows the tooltip, blur hides it.
    document.addEventListener("focusin", (e) => {
      const link = e.target.closest ? e.target.closest("[data-pqdi-id]") : null;
      if (!link || link === tipActiveLink) return;
      hideItemTip();
      hideMemberTip(); // at most one hover panel on screen
      showItemTip(link);
    });
    document.addEventListener("focusout", (e) => {
      if (!tipActiveLink) return;
      const next = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest("[data-pqdi-id]") : null;
      if (next !== tipActiveLink) hideItemTip(); // focus moved elsewhere (another item link re-shows via its focusin)
    });
    window.addEventListener("scroll", makeScrollFollow(() => ({ link: tipActiveLink, panel: tipEl, hide: hideItemTip })), true);
    window.addEventListener("resize", hideItemTip);
    window.addEventListener("hashchange", hideItemTip); // view switches re-render rows under the cursor
  }

  /* ---------------- member / character hover card (hover) ---------------- */
  // Hovering a .member-link or .char-link shows a compact profile summary built from
  // local data only — no fetch: DKP, characters and attendance windows are the same
  // numbers as Member Detail, via the shared memberStats(). Character cards add that
  // character's loot totals. Desktop only (like the item tooltip); names not in the
  // data get no card. pointer-events: none on the panel — it never traps the cursor.
  let memberTipEl = null;
  let memberTipActiveLink = null;

  /** Name from a .member-link href (#/member/<encoded>) — every render site uses this shape. */
  const memberNameFromLink = (link) => {
    const href = link.getAttribute("href") || "";
    return href.startsWith("#/member/") ? decodeURIComponent(href.slice("#/member/".length)) : null;
  };

  function renderMemberCard(name) {
    const s = memberStats(name);
    if (!s.user && s.chars.length === 0) return null; // not in data → no card (matches item tooltip)
    const rankBadge = s.rank && s.rank.toLowerCase() !== "member"
      ? `<span class="mt-rank">${esc(s.rank)}</span>` : "";
    const charsLine = s.chars.length
      ? s.chars.map((c) => `${esc(c.character)} (${esc(c.cls)} ${c.level}, ${esc(c.mainAlt || "—")})`).join(" · ")
      : "No roster characters found.";
    return `
      <div class="mt-head"><span class="mt-name">${esc(name)}</span>${rankBadge}</div>
      <div class="mt-dkp"><b>${s.available.toLocaleString()}</b> available · <b>${s.earned.toLocaleString()}</b> earned · <b>${s.spent.toLocaleString()}</b> spent</div>
      <div class="mt-chars">${charsLine}</div>
      <div class="mt-att">Attended ${s.raidsAttended.toLocaleString()} raids${s.joinedOn ? ` since ${esc(s.joinedOn)}` : ""}</div>
      <div class="mt-windows">
        <span title="Last 30 days (clamped to join date)">30d <b>${fmtPct(s.winAttended["30"], s.winTotal["30"])}</b></span>
        <span title="Last 60 days (clamped to join date)">60d <b>${fmtPct(s.winAttended["60"], s.winTotal["60"])}</b></span>
        <span title="Last 90 days (clamped to join date)">90d <b>${fmtPct(s.winAttended["90"], s.winTotal["90"])}</b></span>
        <span title="Lifetime since join">lifetime <b>${fmtPct(s.winAttended.lifetime, s.winTotal.lifetime)}</b></span>
      </div>`;
  }

  function renderCharCard(charName) {
    const m = String(charName).toLowerCase();
    const row = db.roster.find((r) => r.character.toLowerCase() === m);
    if (!row) return null; // not in roster → no card
    const lootRows = db.loot.filter((l) => String(l.player).toLowerCase() === m);
    const dkpOnLoot = lootRows.reduce((sum, l) => sum + (Number(l.dkpSpent) || 0), 0);
    const rankBadge = row.rank && row.rank.toLowerCase() !== "member"
      ? `<span class="mt-rank">${esc(row.rank)}</span>` : "";
    return `
      <div class="mt-head"><span class="mt-name">${esc(charName)}</span>${rankBadge}</div>
      <div class="mt-sub">${esc(row.cls)} · ${row.level} · ${esc(row.race)} · ${esc(row.mainAlt || "—")}</div>
      <div class="mt-dkp"><b>${(Number(row.availableDkp) || 0).toLocaleString()}</b> available · <b>${(Number(row.earnedDkp) || 0).toLocaleString()}</b> earned · <b>${(Number(row.spentDkp) || 0).toLocaleString()}</b> spent</div>
      <div class="mt-loot">${lootRows.length.toLocaleString()} items won · ${dkpOnLoot.toLocaleString()} DKP on loot</div>
      <div class="mt-member">Member: <a href="#/member/${encodeURIComponent(row.member)}" class="member-link">${esc(row.member)}</a></div>`;
  }

  function showMemberTip(link) {
    if (!db || !memberTipEl) return;
    const isChar = link.classList.contains("char-link");
    const name = isChar ? (link.textContent || "").trim() : memberNameFromLink(link);
    if (!name) return;
    hideItemTip(); // at most one hover panel on screen
    const html = isChar ? renderCharCard(name) : renderMemberCard(name);
    if (html == null) return; // unknown name → no card
    memberTipActiveLink = link;
    memberTipEl.innerHTML = html;
    memberTipEl.hidden = false;
    positionHoverTip(memberTipEl, link);
  }

  function hideMemberTip() {
    memberTipActiveLink = null;
    if (memberTipEl) { memberTipEl.hidden = true; memberTipEl.innerHTML = ""; }
  }

  function setupMemberTips() {
    memberTipEl = $("#member-tip");
    if (!memberTipEl || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return; // desktop only
    const SEL = ".member-link, .char-link";
    document.addEventListener("mouseover", (e) => {
      const link = e.target.closest ? e.target.closest(SEL) : null;
      if (!link || link === memberTipActiveLink) return;
      hideMemberTip();
      showMemberTip(link);
    });
    document.addEventListener("mouseout", (e) => {
      if (!memberTipActiveLink) return;
      const stays = e.relatedTarget && memberTipActiveLink.contains(e.relatedTarget);
      if (!stays) hideMemberTip(); // entering another link re-shows via its mouseover
    });
    // Keyboard parity: Tab to a link shows the card, blur hides it.
    document.addEventListener("focusin", (e) => {
      const link = e.target.closest ? e.target.closest(SEL) : null;
      if (!link || link === memberTipActiveLink) return;
      hideMemberTip();
      showMemberTip(link);
    });
    document.addEventListener("focusout", (e) => {
      if (!memberTipActiveLink) return;
      const next = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(SEL) : null;
      if (next !== memberTipActiveLink) hideMemberTip(); // focus moved elsewhere (another link re-shows via its focusin)
    });
    window.addEventListener("scroll", makeScrollFollow(() => ({ link: memberTipActiveLink, panel: memberTipEl, hide: hideMemberTip })), true);
    window.addEventListener("resize", hideMemberTip);
    window.addEventListener("hashchange", hideMemberTip); // view switches re-render rows under the cursor
  }


  // Footer "Data updated YYYY-MM-DD HH:MM · fresh|cached": the newest Last-Modified
  // across all loaded data files — when the latest export was deployed (local time,
  // plain format) — plus the freshness state; sw.js tags cached responses, so officers
  // always know whether they're looking at live data or the offline copy. Falls back to
  // "Data through <newest raid date>" when the server sends no Last-Modified header.
  function setDataAsOf(raids) {
    const el = $("#data-asof");
    if (!el) return;
    let max = "";
    for (const r of raids || []) if (r.date && r.date > max) max = r.date;
    const cached = Data.staleFiles.length > 0;
    const suffix = cached ? " · cached (offline)" : " · fresh";
    let head = "";
    const up = Data.newestUploadDate();
    if (up) {
      const p = (n) => String(n).padStart(2, "0");
      head = `Data updated ${up.getFullYear()}-${p(up.getMonth() + 1)}-${p(up.getDate())} ${p(up.getHours())}:${p(up.getMinutes())}`;
    } else if (max) {
      head = `Data through ${max}`;
    }
    el.textContent = head ? `${head}${suffix}` : suffix.trim();
    $("#stale-banner").hidden = !cached;
  }

  /* ---------------- init ---------------- */
  async function init() {
    setupNav();

    // Footer credit year — dynamic so it never goes stale.
    $("#footer-year").textContent = new Date().getFullYear();

    // Stagger index for the panel cascade animation (CSS: delay = --i * 45ms).
    document.querySelectorAll(".view").forEach((v) => {
      v.querySelectorAll(":scope > .panel, :scope > .overview-grid > .panel, :scope .detail-grid .panel")
        .forEach((p, i) => p.style.setProperty("--i", String(Math.min(i, 8))));
    });

    // Hash routing + SW registration happen before data loads so the shell stays navigable
    // even when every fetch fails (e.g. an export missing from the repo).
    window.addEventListener("hashchange", () => { renderRoute(parseHash()); inAppNav = false; });
    // Deep-link anchors (<a href="#/…">) change the hash natively: mark them as forward pushes.
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#/"]');
      // Same-hash clicks fire no hashchange — flagging them would leave the direction
      // flag stale and mislabel the next native back as a forward push.
      if (a && a.hash !== location.hash) inAppNav = true;
    });
    if (!location.hash) history.replaceState(null, "", "#/overview"); // normalize for shareability
    renderRoute(parseHash()); // apply the deep link immediately (nav views need no data)

    // Offline support: register the service worker (never blocks the app).
    // Registered directly rather than on window "load" — that event fires
    // before our async data init finishes, so a load listener would never run.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    try {
      const [items, loot, users, raids, roster, transactions] = await Promise.all([
        Data.loadItems(),
        Data.loadLoot(),
        Data.loadUsers(),
        Data.loadRaids(),
        Data.loadRoster(),
        Data.loadTransactions(), // optional file — resolves to [] when absent
      ]);

      setDataAsOf(raids);
      renderOverview(users, loot, items, raids, roster, transactions);
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

      // DKP by Class metric toggle (Available ↔ Spent) — re-sorts every class list.
      for (const [mode, btn] of [["available", $("#cdk-mode-available")], ["spent", $("#cdk-mode-spent")]]) {
        btn.addEventListener("click", () => {
          if (classDkpMode === mode) return;
          classDkpMode = mode;
          $("#cdk-mode-available").classList.toggle("active", mode === "available");
          $("#cdk-mode-spent").classList.toggle("active", mode === "spent");
          renderClassDkpGrid();
        });
      }
      renderLoot(loot, items);
      rosterActiveMembers = computeRosterActiveMembers(raids, roster, users);
      renderRoster(roster);
      renderRaids(raids);
      db = { users, loot, items, roster, raids, transactions };

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
      // Raid history search (debounced)
      let raidsTimer;
      $("#raids-search").addEventListener("input", (e) => {
        clearTimeout(raidsTimer);
        raidsTimer = setTimeout(() => {
          raidSearch = e.target.value;
          applyRaidFilter();
          renderRaidsPage(1);
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
      $("#member-raids-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderMemberRaidsPage(Number(btn.dataset.page));
      });
      $("#member-tx-pager").addEventListener("click", (e) => {
        const btn = e.target.closest(".pager-btn");
        if (!btn || btn.disabled) return;
        renderMemberTxPage(Number(btn.dataset.page));
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
      $("#roster-hide-inactive").addEventListener("change", (e) => {
        rosterState.hideInactive = e.target.checked;
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

      // Member/raid drill-down links are plain anchors (#/member/<name>, #/raid/<id>):
      // the browser updates location.hash and the hashchange listener renders the route.

      // ← Back: native history (falls back to Overview when there's no entry).
      $("#member-back").addEventListener("click", goBack);
      $("#raid-back").addEventListener("click", goBack);
      $("#trend-back").addEventListener("click", goBack);

      // Command palette (needs db, so wired after it is set).
      setupPalette();

      // Hover tooltips/cards — pure delegation, no per-row wiring (item links carry
      // data-pqdi-id; member/char cards read the href / link text).
      setupItemTooltips();
      setupMemberTips();

      // Re-apply the initial route now that data exists — a deep link into a drill-down
      // can't be rendered until db is set (renderRoute no-ops those early).
      renderRoute(parseHash());

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
