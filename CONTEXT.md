# CONTEXT.md — Axiom-DKP2

Read-only, fully client-side dashboard for **EverQuest raid DKP** accounting for guild **"Axiom"** (display name "Axiom DKP Metrics"). Plain HTML/CSS/JS — no server, build step, or framework. Loads local JSON/CSV exports via `fetch`; item links go to pqdi.cc.

Run over HTTP (`fetch` is blocked on `file://`):
```
npx serve .   # or: python3 -m http.server 8000
```

## Files

| File | Role |
|---|---|
| `index.html` | App shell, navigation, and 7 view sections (5 nav views + Member Detail and Raid Detail drill-downs). |
| `js/data.js` | **Data layer** — fetches, validates, and normalizes all data. |
| `js/app.js` | **Presentation** — hash routing (URL is source of truth), nav switching, view rendering, pagination, and search. |
| `style.css` | Main CSS manifest (imports modular files from `css/`). |
| `css/` | Modular CSS: `base`, `components`, `layout`, `variables`, `views`. |
| `manifest.webmanifest`, `icon-192.png`, `icon-512.png` | Home-screen / favicon icons (guild icon); linked from index.html head, copied by test/e2e/serve.mjs |
| `sw.js` | Service worker for offline support: precaches the app shell; data files + the PapaParse CDN script are stale-while-revalidate. Registered in app.js init(). |
| `items.json` | Item database for `pqdi.cc` link resolution — **internal reference only**. Deliberately NOT exposed as a UI view (owner decision: no item search in the app; do not add one back). |
| `loot.json` | History of awarded items. |
| `raids.json` | Log of all raids and attendance. |
| `users.json` | Account-level DKP and character lists. |
| `roster-export.csv` | Per-character roster and DKP metrics. |
| `transactions.json` | *Unused* (adjustments already baked into `users.json`). |
| `test/` | Tests: unit (`unit/`), data integrity (`integrity/`), E2E (`e2e/`) + sample-data fixtures. Dev-only; the app itself stays dependency-free. |

Note: `loot.json`, `raids.json`, `users.json`, and `roster-export.csv` are **gitignored** (guild-internal data); only `items.json` is committed. Tests fall back to `test/fixtures/sample-data/` when the real exports are absent (e.g. in CI).

## Data flow

```
index.html → PapaParse (CDN), js/data.js (`Data`), js/app.js (IIFE)
data.js: fetch + validate + normalize + Map indexes
  - shared cached `fetchRaids()` promise: raids.json is fetched + parsed once per page load,
    even though both loadLoot (via loadRaidInfo) and loadRaids need it; failures are not
    cached, so a retry re-fetches
app.js init(): Promise.all([loadItems, loadLoot, loadUsers, loadRaids, loadRoster])
         → render all views, wire nav / pagers / search; module state db = { users, loot, items, roster, raids }
         → hash routing bootstrap: window "hashchange" listener + initial renderRoute(parseHash())
           (empty hash normalized to #/overview via replaceState)
test hook: data.js ends with `if (typeof module !== "undefined") module.exports = Data` —
  no-op in the browser, lets Vitest/Node require() the IIFE result
```

## Key Mechanics

- **Date resolution:** Loot rows missing `date` resolve via `raid_id → raids[].date` (truncated `YYYY-MM-DD`).
- **Join-key normalization:** `raid_id` and `username_id` values are coerced to strings at the data.js boundary (`loadLoot`, `loadRaids`, `loadUsers`, `loadRaidInfo`) so cross-file Map/Set joins can't silently break on string/number type drift between exports. `loadRaids()` also accepts legacy plain-string attendee entries (current exports use `{ username_id, character_name }` objects).
- **Item links:** `Data.itemLink(itemName, byName)` joins by **name string** via `byName: Map<lowercase NAME, id>` → `https://www.pqdi.cc/item/{id}`; falls back to escaped plain text when the name is unknown. Names mapping to **multiple ids are ambiguous**: `byName` keeps the **largest id** deterministically (every candidate is a pqdi.cc page for an item bearing that exact name, and the larger/newer entry carries more complete data — owner decision 2026-08: link rather than plain text); `loadItems()` also returns them in an `ambiguous: Set<string>`.
- **Quarmy character links:** `quarmyLink(name)` in app.js → `<a class="char-link" href="https://quarmy.com/public?q={encodeURIComponent(name)}" target="_blank">`. Applied at every single-character-name render site (grep `quarmyLink`). **Non-www host only — `www.quarmy.com` returns 503.**
- **Security:** `Data.escapeHtml` is applied to all user-generated data rendered into `innerHTML`.
- **Pagination:** client-side via event delegation on `#*-pager` containers, all rendered by one shared `renderPager()` helper (windowed page buttons with ellipses; hidden when ≤1 page). Per-view page sizes are constants at the top of app.js.
- **Errors:** Load failures replace `.panel-status` elements with an error message.
- **Mobile bottom nav (≤700px):** the sidebar is ordered *after* the content in flow and pins with `position: sticky; bottom: 0`. Do NOT revert to `position: fixed` — iOS/Android leave fixed elements behind when the dynamic layout viewport resizes as content grows. Sticky stays in flow, so it survives viewport-height changes.
- **Hash routing:** the URL is the source of truth for the current view: `#/<view>` for the five nav views, `#/member/<name>` and `#/raid/<id>` for drill-downs (segments percent-encoded). Nav clicks, member/raid links, and palette rows all push history entries via `navigate()`, so browser back/forward (incl. mobile hardware back) work natively, refresh keeps state, and deep links restore the exact view on load (`renderRoute(parseHash())` after data loads; an empty hash is normalized to `#/overview` with replaceState). Drill-downs clear the nav highlight while open; returning restores it. The ← Back buttons call `history.back()`, falling back to Overview when there's no history entry (e.g. a deep link opened in a fresh tab).
- **Command palette:** Ctrl+K / "/" (outside inputs) / topbar button opens an overlay searching members, characters, items (loot names), raids, plus view quick-jumps when the query is empty. Enter/click navigates via hash routing — member/char rows → `#/member/<name>`, raid rows → `#/raid/<id>` — so browser back returns to the origin view; item rows open pqdi.cc in a new tab; view rows switch nav views.
- **Offline PWA:** `sw.js` precaches the app shell at install; navigations are network-first with cached index.html fallback; every other GET (data JSON/CSV, static assets, cross-origin PapaParse — opaque responses are cacheable) is stale-while-revalidate, so an offline reload boots from last-known-good data. Registered **directly in init()**, not on window "load" — that event fires before async data init completes, so a load listener never runs.
- **Motion:** `.view.active` fade/slide-in, stat-card count-up (`animateCount`, ~650ms ease-out) + hover lift, pager transitions. All disabled under `prefers-reduced-motion` (CSS media query + JS matchMedia guard).

## `Data` exports (js/data.js)

`loadItems`, `loadRaidInfo`, `loadLoot`, `loadRaids`, `loadUsers`, `loadRoster`, `loadCsv(url)` — full return shapes are in each function's JSDoc. Non-obvious bits:

- `raidId` is kept even when unknown (exact joins); raid **names repeat over time** (multi-raid days), so per-raid joins must use `id`, never `name`.
- All dates go through `isoDate()`: any exported timestamp → `YYYY-MM-DD`; empty/unparseable → null, so junk can never reach a date cell.
- `loadUsers()` has no characters — those come from the roster.

## app.js — Views & UI

- **Views:** Five sidebar views — Overview, Standings, Loot, Roster, Raids — plus two drill-downs (not in the nav): Member Detail and Raid Detail.
- **Overview Stats:** four cards — Active DKP (summed over members seen on a raid past 30d), Items Awarded (past week), Avg DKP Spent · past week (per member — grouped by owner username_id, character-name fallback), and Avg Raid Size (past 30d). An earlier Active Raiders / Applicants pair was deliberately removed as redundant (covered by the Raider Trend panel + Recent Joiners status line) — don't re-add.
- **Overview Insight Panels:** two-column grid below the stat cards (full-width items use `.overview-wide`): **Guild Activity** — dual bars per week over the last 12 weeks (gold = raids, blue = DKP spent); **Raid Activity · past year** — GitHub-style daily heatmap (364 day-cells, 52 columns × 7 rows, Sunday-aligned), gold intensity = raids that day, status shows total/active days/busiest day; **Most Active · past 30 days** — top 5 members by raids attended (`attendeeUserIds` only), status counts "core" raiders (`CORE_RAIDS_MIN = 8` in the window) of all active; **Top Spenders · past 30 days** — top 5 members by `dkpSpent` (member via username_id, character-name fallback); **Biggest Spends · past 30 days** — top 5 single loot awards; **Characters by Class · active 30d** — roster characters of members seen on a raid in the past 30 days, per-class bars + mains/alts split in status; **Recent Joiners** — newest 5 members with relative age + total 30-day join count in status; **Raider Trend** — unique attendees (`attendeeUserIds`) per week over 12 weeks; status averages only weeks that had ≥1 raid (empty weeks don't drag the average down); **Recent Raids** — last 8 raids, full-width table, loot column joined on exact `raid_id`, names are `.raid-link`s into Raid Detail. Most Active / Top Spenders / Recent Joiners names are `.member-link`s (plain anchors to `#/member/<name>`, so they work from any view).
- **Standings:** one row per member with earned/spent breakdown and 30D/60D/90D/Lifetime attendance as `NN% (attended/total)` — same window semantics as Member Detail (join-date clamping; presence = username_id OR character name; "–" when a window has no raids). All data columns sortable via shared `th.sortable` (windows sort by the numeric %, nulls always last; first click on any column = descending); default active DKP desc. Raider names are `.member-link`s; search filters by raider name.
- **Roster:** Features search, filters (Rank, Main/Alt, Class), and sortable headers (`th.sortable`).
- **Raid History:** newest-first list of all raids; debounced search filters by raid name / date / attendee. Page size 25 like every other view. The Attendees column is collapsed to the first three names + “+N more” (full list in a `title` tooltip) — the old per-row text wall made the table unreadable; Raid Detail has the full chips.
- **Member Detail:** drill-down via `.member-link` anchors pointing at `#/member/<name>`; ← Back uses native browser history. Unknown names render an explicit not-found state (stats as “–”) instead of zeros that would look like real data. Rank badge shows roster `Rank`, hidden for the default "member" rank. DKP prefers `users.json` account values, falling back to roster sums; characters come from the roster (matched by member name). Member loot is scoped by **character name** (case-insensitive) — not username_id.
- **Raid Detail:** drill-down via `.raid-link` anchors pointing at `#/raid/<id>` (Recent Raids + Raid History); ← Back uses native browser history. Unknown ids render an explicit not-found state. All data scoped to the exact raid by `raid_id`, never name. Attendees are grouped into members via roster character-name matching and rendered as compact wrapping chips (`.attendee-chips`): one chip per member (clickable → profile), characters inside a chip only when multi-boxed, unrostered chars as dashed muted chips; the "Members Attended" stat counts members + unrostered characters. Loot table is paginated, biggest award first, Owner column links to the member profile.
- **Attendance stats:** summary line shows **Raids Attended** (any of the member's characters or their `username_id` in attendees) and **Raids Since Joined** (on/after earliest roster `ApplicationDate` / `MembershipDate`; "–" when neither exists). The strip shows attended ÷ total for 30/60/90-day windows, each **clamped to the join date** (no join date → full window) plus Lifetime; zero-raid windows show "–". Same convention as Standings.
- **Search:** Debounced (200ms) for Standings, Loot, Raids, and Roster views.

## DKP Semantics

- **Earned:** Per raid attendance (`raid_dkp_value`).
- **Spent:** Σ `item_dkp_value` from awarded loot.
- **Available:** `earned - spent` (+ manual adjustments).
- **Joins:** 
    - `loot[].raid_id` ↔ `raids[].raid_id` (date + raid-name resolution).
    - `loot item` ↔ `items` by **name string** (via `byName` map) — not id.
    - Member↔loot in the UI is by **character name**: `loadLoot()` exposes the owner as `user` (username_id or null), but `openMember()` still matches loot to the member's roster characters case-insensitively — character-name scoping survives renamed/retired accounts either way.
    - Overview stats count unique members via `loadRaids()`'s derived `attendeeUserIds` (from `attendees[].username_id`) — a member on multiple characters counts once.

## Testing

Three layers — see README for details:

- **Unit** (`test/unit/`, Vitest): data-layer logic with mocked `fetch`/`Papa`.
- **Integrity** (`test/integrity/`, Vitest): cross-file invariants on the real exports when present locally (unique IDs, ISO dates, no future raids, loot→raid/user joins, roster↔users username match, per-user spent-DKP exactness + earned-drift bounds, item-name coverage); falls back to `test/fixtures/sample-data/` otherwise.
- **E2E** (`test/e2e/`, Playwright): loads the real UI over HTTP via `serve.mjs` (real data locally, sample dataset in CI) — no console/page errors, all views render and update the URL hash, search/sort/pagination + member & raid drill-downs with back navigation work, browser back/forward navigate natively between views and drill-downs, deep links (`#/member/<name>`) restore state after a full reload, pqdi.cc/Quarmy link targets correct, every visible date is plain YYYY-MM-DD, PWA manifest/icons served correctly, command palette opens/searches/navigates, heatmap renders 364 cells, offline reload boots from the service-worker cache, mobile bottom nav stays pinned (full list in `app.spec.js`).

Run: `npm test` and `npm run test:e2e`. CI (`.github/workflows/ci.yml`) runs both on push/PR.

**After re-exporting data files, always run `npm test` before using the dashboard** — the integrity tests validate new exports against the invariants above (types, ISO dates, cross-file joins) and are the early-warning system for export-format drift.

## Commit workflow

The **user** commits and pushes — the agent does NOT commit or push (owner decision, 2026-08-20: "stop committing and trying to sync, I will do those"). The agent's job ends at: changes applied + `npm test` AND `npm run test:e2e` fully green (plus a syntax check where relevant), then report what changed so the user can commit. Guild data files stay gitignored and must never be staged.
