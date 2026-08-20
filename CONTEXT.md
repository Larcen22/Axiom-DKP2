# CONTEXT.md — Axiom-DKP2

Read-only, fully client-side dashboard for **EverQuest raid DKP** accounting for guild **"Axiom"** (display name "Axiom DKP Metrics"). Plain HTML/CSS/JS — no server, build step, or framework. Loads local JSON/CSV exports via `fetch`; item links go to pqdi.cc.

Run over HTTP (`fetch` is blocked on `file://`):
```
npx serve .   # or: python3 -m http.server 8000
```

## Files

| File | Role |
|---|---|
| `index.html` | App shell, navigation, and 7 view containers. |
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
         → render all views, wire nav / pagers / search; module state db = { users, loot, items, roster }
test hook: data.js ends with `if (typeof module !== "undefined") module.exports = Data` —
  no-op in the browser, lets Vitest/Node require() the IIFE result
```

## Key Mechanics

- **Date resolution:** Loot rows missing `date` resolve via `raid_id → raids[].date` (truncated `YYYY-MM-DD`).
- **Item links:** `Data.itemLink(itemName, byName)` joins by **name string** via `byName: Map<lowercase NAME, id>` → `https://www.pqdi.cc/item/{id}`; falls back to escaped plain text when the name is unknown.
- **Security:** `Data.escapeHtml` is applied to all user-generated data rendered into `innerHTML`.
- **Pagination:** Client-side via event delegation on `#*-pager` containers. Page sizes: 25 (most views), 5 (raids).
- **Errors:** Load failures replace `.panel-status` elements with an error message.

## `Data` exports (js/data.js)

| Export | Returns / does |
|---|---|
| `loadItems()` | `{ byId, byName, rows }`. |
| `loadRaidInfo()` | `Map<raid_id, { date, name }>` for loot resolution. |
| `loadLoot()` | Normalized rows `{ date?, player, item, raid?, dkpSpent }`. |
| `loadRaids()` | `[{ date, name, dkpValue, attendees:string[], attendeeUserIds:string[] }]`. |
| `loadUsers()` | `{ username, usernameId, activeDkp, earned, spent }`. (No characters — those come from the roster.) |
| `loadRoster()` | Parses `roster-export.csv` into `{ member, character, cls, level, race, mainAlt, rank, availableDkp, earnedDkp, spentDkp, applied, memberSince }`. |
| `loadCsv(url)` | Generic PapaParse fetch+parse (`download: true`, header row, numeric transform). |
| `itemLink(itemName, byName)`, `escapeHtml(str)` | Helpers for pqdi.cc links and HTML safety. |

## app.js — Views & UI

- **Views:** Five sidebar views — Overview, Standings, Loot, Roster, Raids — plus Member Detail (drill-down, not in the nav).
- **Overview Stats:** Active DKP (summed over members seen on a raid past 30d), Items Awarded (past week), Avg DKP Spent · past week, Active Raiders (unique owners past 7d), Avg Raid Size (past 30d), and Applicants (roster `ApplicationDate` in past 30d).
- **Roster:** Features search, filters (Rank, Main/Alt, Class), and sortable headers (`th.sortable`).
- **Member Detail:** Drill-down via `.member-link`. DKP prefers `users.json` account values, falling back to roster sums. Characters come from the roster (matched by member name). Member loot is scoped by **character name** (case-insensitive) — not username_id — and capped at `MEMBER_LOOT_CAP` rows.
- **Search:** Debounced (200ms) for Loot and Roster views.

## DKP Semantics

- **Earned:** Per raid attendance (`raid_dkp_value`).
- **Spent:** Σ `item_dkp_value` from awarded loot.
- **Available:** `earned - spent` (+ manual adjustments).
- **Joins:** 
    - `loot[].raid_id` ↔ `raids[].raid_id` (date + raid-name resolution).
    - `loot item` ↔ `items` by **name string** (via `byName` map) — not id.
    - Member↔loot in the UI is by **character name**: raw `loot[]` rows carry a `username_id`, but `loadLoot()` drops it, so `openMember()` matches loot to the member's roster characters case-insensitively.
    - Overview stats count unique members via `raids[].attendees[].username_id` (a member on multiple characters counts once).

## Testing

Three layers — see README for details:

- **Unit** (`test/unit/`, Vitest): data-layer logic with mocked `fetch`/`Papa`.
- **Integrity** (`test/integrity/`, Vitest): cross-file invariants on the real exports when present locally (unique IDs, ISO dates, no future raids, loot→raid/user joins, roster↔users username match, per-user spent-DKP exactness + earned-drift bounds, item-name coverage); falls back to `test/fixtures/sample-data/` otherwise.
- **E2E** (`test/e2e/`, Playwright): loads the real UI over HTTP via `serve.mjs` (real data locally, sample dataset in CI) — no console/page errors, all views render, search/pagination/drill-down work, pqdi.cc links correct.

Run: `npm test` and `npm run test:e2e`. CI (`.github/workflows/ci.yml`) runs both on push/PR.
