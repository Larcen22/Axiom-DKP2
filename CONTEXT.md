# CONTEXT.md — Axiom-DKP2

Read-only, fully client-side dashboard for **EverQuest raid DKP** accounting for guild **"Axiom"** (display name "Axiom DKP Metrics"). Plain HTML/CSS/JS — no server, build step, or framework. Loads local JSON/CSV exports via `fetch`; item links go to pqdi.cc.

Run over HTTP (`fetch` is blocked on `file://`):
```
npx serve .   # or: python3 -m http.server 8000
```

## Files

| File | Role |
|---|---|
| `index.html` | App shell, navigation, and 6 view sections (5 nav views + Member Detail drill-down). |
| `js/data.js` | **Data layer** — fetches, validates, and normalizes all data. |
| `js/app.js` | **Presentation** — nav switching, view rendering, pagination, and search. |
| `style.css` | Main CSS manifest (imports modular files from `css/`). |
| `css/` | Modular CSS: `base`, `components`, `layout`, `variables`, `views`. |
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
test hook: data.js ends with `if (typeof module !== "undefined") module.exports = Data` —
  no-op in the browser, lets Vitest/Node require() the IIFE result
```

## Key Mechanics

- **Date resolution:** Loot rows missing `date` resolve via `raid_id → raids[].date` (truncated `YYYY-MM-DD`).
- **Item links:** `Data.itemLink(itemName, byName)` joins by **name string** via `byName: Map<lowercase NAME, id>` → `https://www.pqdi.cc/item/{id}`; falls back to escaped plain text when the name is unknown. Names mapping to **multiple ids are ambiguous** and excluded from `byName` (rendered as plain text — owner decision: never guess an expansion); `loadItems()` also returns them in an `ambiguous: Set<string>`.
- **Security:** `Data.escapeHtml` is applied to all user-generated data rendered into `innerHTML`.
- **Pagination:** Client-side via event delegation on `#*-pager` containers, all rendered by one shared `renderPager(containerId, currentPage, totalPages)` helper (windowed page buttons with ellipses; hidden when ≤1 page). Page sizes: 25 (standings/loot/roster), 5 (raids), 10 (member loot).
- **Errors:** Load failures replace `.panel-status` elements with an error message.

## `Data` exports (js/data.js)

| Export | Returns / does |
|---|---|
| `loadItems()` | `{ byId, byName, ambiguous: Set<string>, rows }` — names mapping to multiple ids are excluded from `byName` and listed in `ambiguous`. |
| `loadRaidInfo()` | `Map<raid_id, { date, name }>` for loot resolution. |
| `loadLoot()` | Normalized rows `{ date, player, user, item, raid, dkpSpent }` — `date`/`raid` are null when unresolvable; `user` is the owner username_id (or null) for member-level grouping. All dates normalized to `YYYY-MM-DD` via `isoDate()` (exports occasionally carry full ISO timestamps; empty/unparseable values become null so junk can never reach a date cell). |
| `loadRaids()` | `[{ date, name, dkpValue, attendees:string[], attendeeUserIds:string[] }]` — dates likewise normalized to `YYYY-MM-DD`. |
| `loadUsers()` | `{ username, usernameId, activeDkp, earned, spent }`. (No characters — those come from the roster.) |
| `loadRoster()` | Parses `roster-export.csv` into `{ member, character, cls, level, race, mainAlt, rank, availableDkp, earnedDkp, spentDkp, applied, memberSince }`. |
| `loadCsv(url)` | Generic PapaParse fetch+parse (`download: true`, header row, numeric transform). |
| `itemLink(itemName, byName)`, `escapeHtml(str)`, `isoDate(v)` | Helpers for pqdi.cc links, HTML safety, and date normalization (any exported timestamp → `YYYY-MM-DD`; empty/unparseable → null). |

## app.js — Views & UI

- **Views:** Five sidebar views — Overview, Standings, Loot, Roster, Raids — plus Member Detail (drill-down, not in the nav).
- **Overview Stats:** four cards — Active DKP (summed over members seen on a raid past 30d), Items Awarded (past week), Avg DKP Spent · past week (per member — grouped by owner username_id), and Avg Raid Size (past 30d). Formerly also had Active Raiders and Applicants cards, removed as redundant: raider counts are covered by the Raider Trend panel, and the 30-day join count now lives in the Recent Joiners status line (`X joined in the past 30 days`).
- **Overview Insight Panels** (two-column grid below the stat cards; rows: Guild Activity full-width, three pairs, Recent Raids table full-width): **Guild Activity** — dual bar series per week over the last 12 weeks (gold = raids, blue = DKP spent; 7-day buckets from today, zero-weeks render as stubs, hover tooltip shows both values); **Most Active · past 30 days** — top 5 members by raids attended (`attendeeUserIds`), status line counts "core" raiders (8+ raids in the window) of all active members; **Recent Raids** — last 8 raids (date/name/attendee count, full-width table); **Top Spenders · past 30 days** — top 5 members by `dkpSpent` summed over loot entries whose raid-resolved date falls in the window (member name via `users.json` username_id, character-name fallback); **Biggest Spends · past 30 days** — top 5 single loot awards (item link + character + amount); **Characters by Class · active 30d** — roster characters of members seen on a raid in the past 30 days (member → username_id via users.json, matched against `attendeeUserIds`), counted per class as bar list, status line also shows the mains/alts character split; **Recent Joiners** — newest 5 members by earliest applied/memberSince with relative age, status line includes the count of all joins in the past 30 days; **Raider Trend** — unique attendees (`attendeeUserIds`) per week over the last 12 weeks, green bars; status line averages unique raiders across only the weeks that had at least one raid (empty weeks don't drag the average down). Most Active, Top Spenders, and Recent Joiners names are `.member-link`s — the drill-down click handler is delegated on `document` (not just the roster tbody) so they work from any view.
- **Standings:** One row per member sorted by active DKP with earned/spent breakdown, plus raid attendance for 30D / 60D / 90D / Lifetime shown as `NN% (attended/total)` — same window semantics as Member Detail (windows clamped to the member's join date, Lifetime starts at the join date, presence = username_id OR character name; "–" when a window has no raids). All data columns are sortable (shared `th.sortable` pattern; raid windows sort by the percentage number, "–" rows always last); default is active DKP descending. Raider names are `.member-link`s. Search input filters by raider name.
- **Roster:** Features search, filters (Rank, Main/Alt, Class), and sortable headers (`th.sortable`).
- **Member Detail:** Drill-down via `.member-link`. Layout: header (name + rank badge — roster `Rank`, hidden when the default "member") with character chips beneath, a 3-card DKP row, a Raid Attendance panel, then Loot History. DKP prefers `users.json` account values, falling back to roster sums. Characters come from the roster (matched by member name). Member loot is scoped by **character name** (case-insensitive) — not username_id — and paginated (`MEMBER_LOOT_PAGE_SIZE = 10`) with the same shared pager as the other views.
- **Attendance stats:** **Raids Attended** (raids where any of the member's characters or their `username_id` appears in attendees) and **Raids Since Joined** (raids dated on/after the earliest of roster `ApplicationDate` / `MembershipDate`; "–" when neither date exists) render as a summary line under the attendance strip. The strip shows attended ÷ total raids for 30/60/90-day windows, each **clamped to the member's join date** (a 2-week member's "30D" covers only their actual 2 weeks; no join date → full window) plus Lifetime (raids since the join date). Windows with zero raids — or a missing join date for Lifetime — show "–". All computed in one pass over `db.raids`.
- **Search:** Debounced (200ms) for Standings, Loot, and Roster views.

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
- **E2E** (`test/e2e/`, Playwright): loads the real UI over HTTP via `serve.mjs` (real data locally, sample dataset in CI) — no console/page errors, all views render, search/pagination/drill-down work, pqdi.cc links correct.

Run: `npm test` and `npm run test:e2e`. CI (`.github/workflows/ci.yml`) runs both on push/PR.

## Commit workflow

The agent commits + pushes to `main` after each verified change. **Rule: nothing is committed or pushed unless `npm test` AND `npm run test:e2e` are fully green first** (plus a syntax check where relevant). Guild data files stay gitignored and must never be staged.
