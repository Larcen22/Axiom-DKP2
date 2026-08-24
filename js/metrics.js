/**
 * js/metrics.js — pure attendance-metric helpers for the Overview insight panels.
 *
 * Kept separate from app.js so the detectors can be unit-tested without a DOM.
 * All functions are pure (no globals, no Date.now) and take an explicit `asOf`
 * ISO date ("YYYY-MM-DD") as the reference point; callers pass today's date.
 *
 * Presence semantics match Standings' 30D column: a raid counts for a member if
 * their username_id is in attendeeUserIds OR any of their roster character names
 * appears in attendees (names are case-insensitive). Raids before the member's
 * join date (min of applied / memberSince across their roster rows) are ignored.
 */

(function (global) {
  "use strict";

  const DAY_MS = 86400000;

  function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** ISO date `n` days before `asOfStr`. Noon anchor avoids DST edge shifts. */
  function daysBefore(asOfStr, n) {
    const d = new Date(`${asOfStr}T12:00:00`);
    d.setDate(d.getDate() - n);
    return isoOf(d);
  }

  /** Whole days between two ISO dates (b − a). */
  function dayDiff(a, b) {
    return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / DAY_MS);
  }

  /**
   * Per-member raid attendance.
   * @param raids  normalized raids (data.js shape: date, attendees[], attendeeUserIds[])
   * @param roster raw roster rows ({ member, character, applied, memberSince })
   * @param users  normalized users ({ username, usernameId })
   * @returns Array of { member, usernameId, joinDate, dates } — one entry per roster
   *   member (exact MemberName casing), `dates` sorted ascending ISO strings.
   */
  function attendanceByMember(raids, roster, users) {
    const userByName = new Map();
    for (const u of users) userByName.set(u.username.toLowerCase(), u);

    // member -> { usernameId, charNames:Set(lowercase), joinDate }
    const byMember = new Map();
    for (const row of roster) {
      if (!row.member) continue;
      let m = byMember.get(row.member);
      if (!m) {
        m = { member: row.member, usernameId: userByName.get(row.member.toLowerCase())?.usernameId || "", charNames: new Set(), joinDate: "" };
        byMember.set(row.member, m);
      }
      if (row.character) m.charNames.add(row.character.toLowerCase());
      for (const d of [row.applied, row.memberSince]) {
        if (!d) continue;
        if (!m.joinDate || d < m.joinDate) m.joinDate = d;
      }
    }

    // Inverted indexes so each raid is scanned once.
    const memberByUid = new Map();   // usernameId -> member entry
    const membersByChar = new Map(); // lowercase char name -> [member entries]
    for (const m of byMember.values()) {
      if (m.usernameId) memberByUid.set(m.usernameId, m);
      for (const cn of m.charNames) {
        let arr = membersByChar.get(cn);
        if (!arr) { arr = []; membersByChar.set(cn, arr); }
        arr.push(m);
      }
    }

    const datesByMember = new Map(); // member -> Set of raid dates
    for (const r of raids) {
      if (!r.date) continue;
      const present = new Set();
      for (const uid of r.attendeeUserIds || []) {
        const m = memberByUid.get(uid);
        if (m && !(m.joinDate && r.date < m.joinDate)) present.add(m);
      }
      for (const name of r.attendees || []) {
        const arr = membersByChar.get(name.toLowerCase());
        if (!arr) continue;
        for (const m of arr) if (!(m.joinDate && r.date < m.joinDate)) present.add(m);
      }
      for (const m of present) {
        let s = datesByMember.get(m.member);
        if (!s) { s = new Set(); datesByMember.set(m.member, s); }
        s.add(r.date);
      }
    }

    const out = [];
    for (const m of byMember.values()) {
      const set = datesByMember.get(m.member);
      out.push({ member: m.member, usernameId: m.usernameId, joinDate: m.joinDate, dates: set ? [...set].sort() : [] });
    }
    return out;
  }

  /**
   * Members whose attendance dropped sharply: at least `minPrior` raids in the prior
   * 30-day window (days 60–31 before asOf) and at most `maxRecent` in the last 30 days.
   * @returns Array of { member, usernameId, prior, recent }, sorted by drop size desc.
   */
  function findDecliningMembers(members, opts = {}) {
    const asOf = opts.asOf || isoOf(new Date());
    const minPrior = opts.minPrior ?? 4;
    const maxRecent = opts.maxRecent ?? 1;
    const recentStart = daysBefore(asOf, 30); // inclusive: raid on this day counts as "recent"
    const priorStart = daysBefore(asOf, 60);  // inclusive
    const out = [];
    for (const m of members) {
      let prior = 0, recent = 0;
      for (const d of m.dates) {
        if (d > asOf) continue; // future-dated raids don't count toward "now"
        if (d >= recentStart) recent++;
        else if (d >= priorStart) prior++;
      }
      if (prior >= minPrior && recent <= maxRecent) out.push({ member: m.member, usernameId: m.usernameId, prior, recent });
    }
    return out.sort((a, b) => (b.prior - b.recent) - (a.prior - a.recent) || a.member.localeCompare(b.member));
  }

  /**
   * Members back in the last `recentDays` days after an absence of at least
   * `minGapDays` since their previous raid. New joiners (no prior raids) and members
   * still absent are excluded.
   * @returns Array of { member, usernameId, returnDate, lastSeen, gapDays }, most
   *   recent return first. `returnDate` is the first raid in the window; `lastSeen`
   *   is their most recent raid overall (may be later than returnDate).
   */
  function findReturningMembers(members, opts = {}) {
    const asOf = opts.asOf || isoOf(new Date());
    const recentDays = opts.recentDays ?? 30;
    const minGapDays = opts.minGapDays ?? 45;
    const windowStart = daysBefore(asOf, recentDays); // inclusive
    const out = [];
    for (const m of members) {
      let lastBefore = "", firstInWindow = "", lastSeen = "";
      for (const d of m.dates) { // dates are sorted ascending
        if (d > asOf) break;
        lastSeen = d;
        if (d < windowStart) lastBefore = d;
        else if (!firstInWindow) firstInWindow = d;
      }
      if (!lastBefore || !firstInWindow) continue; // no prior history, or not back yet
      const gapDays = dayDiff(lastBefore, firstInWindow);
      if (gapDays >= minGapDays) out.push({ member: m.member, usernameId: m.usernameId, returnDate: firstInWindow, lastSeen, gapDays });
    }
    return out.sort((a, b) => b.returnDate.localeCompare(a.returnDate) || a.member.localeCompare(b.member));
  }

  const api = { attendanceByMember, findDecliningMembers, findReturningMembers, daysBefore, dayDiff };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node/vitest (CJS require)
  else if (global) global.Metrics = api; // browser
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
