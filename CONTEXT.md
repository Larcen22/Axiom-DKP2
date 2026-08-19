# CONTEXT.md — Axiom-DKP2

Read-only, fully client-side dashboard for **EverQuest raid DKP** accounting for guild **"Axiom"** (display name "Axiom DKP Metrics"). Plain HTML/CSS/JS — no server, build step, or framework. Loads local JSON/CSV exports via `fetch`; item links go to pqdi.cc.

Run over HTTP (`fetch` is blocked on `file://`):
```
npx serve .   # or: python3 -m http.server 8000
```

## Files

| File | Role |
|---|---|
| `index.html` (~277 ln) | App shell: topbar, sidebar nav, 7 views (Overview/Items/Standings/Loot/Roster/Member/Raids), footer. Loads PapaParse CDN + local scripts. |
| `js/data.js` (~217 ln) | **Data layer** — fetches/validates/normalizes all data files, builds Map indexes. Global `Data`. |
| `js/app.js` (~622 ln) | **Presentation IIFE** (no globals) — nav switching, renders 7 views, pagination, member drill-down, debounced search. |
| `style.css` (~383 ln) | Dark theme via CSS custom props in `:root` (`--bg #0d1015`, gold `--accent #e0a435`, steel blue `--accent-2 #4fa3e0`); grid shell (220 px sidebar, max-width 1400 px), stat cards, tables, rank medals, pagers, roster controls. No JS coupling. |
| `items.json` (~1.6 MB) | `{ table:"items", rows:[{ id, NAME }] }`. |
| `loot.json` (~2.1 MB) | `{ loot:[{ item, character_name, character_id, username_id, raid_id, item_dkp_value, date? }] }` — one row per awarded item; many lack `date`. |
| `raids.json` (~8.2 MB) | `{ raids:[{ raid_id, raid_name, date, raid_dkp_value, attendees:[{ username_id, character_name }] }] }`. |
| `users.json` (~318 KB) | `{ users:[{ username, username_discord, username_id, rank, available_dkp, dkp_earned, dkp_spent, characters:[{ name, class, character_id, role, level, race }], ApplicationDate, ... }] }`. |
| `roster-export.csv` (~77 KB) | Per-character roster: `MemberName, CharacterName, Class, Level, Race, Main/Alt, Rank, AvailableDKP, EarnedDKP, SpentDKP, ApplicationDate, MembershipDate`. |
| `transactions.json` (~597 KB) | **Unused** — referenced by no code. |

## Data flow

```
index.html → PapaParse (CDN), js/data.js (`Data`), js/app.js (IIFE)
data.js: fetch + validate + normalize + Map indexes; shared cached `fetchRaids()` promise
         (raids.json fetched + parsed once per page load, resets on failure so retries re-fetch)
app.js init(): Promise.all([loadItems, loadLoot, loadUsers, loadRaids, loadRoster])
         → render all views, wire nav / pagers / search; module state db = { users, loot, items, roster }
```

Key mechanics:
- **Date resolution:** loot rows missing `date` fall back to `raid_id → raids[].date` (truncated `YYYY-MM-DD`). Loot rows also carry the resolved `raid` name.
- **Item links:** `Data.itemLink(name)` joins by **name string** (not id) via `byName: Map<lowercase NAME, id>` → `https://www.pqdi.cc/item/{id}`; escaped plain-text fallback if absent from items.json.
- **Security:** `Data.escapeHtml` applied to all user data rendered into innerHTML.
- **Pagination:** client-side, shared pager component (25/page for recent-loot/standings/loot/roster, 5/page raids). Pager buttons are re-created on every render → clicks handled by **event delegation** on the persistent `#*-pager` containers (one listener per table, wired once in `init()`). Item table is capped at 100 rendered rows with no pagination.
- **Errors:** any load failure replaces all `.panel-status` elements with "Failed to load data: …" (`.error`).

## `Data` exports (js/data.js)

| Export | Returns / does |
|---|---|
| `loadItems()` | `{ byId, byName, rows }`; skips malformed rows. `byName` powers pqdi.cc links. |
| `loadRaidInfo()` | `Map<raid_id, { date: "YYYY-MM-DD" \| null, name }>` for loot resolution. |
| `loadLoot()` | Normalized rows `{ date?, player, item, raid?, dkpSpent:Number }` (date = own ?? raid date; `dkpSpent` = `item_dkp_value`). |
| `loadRaids()` | `[{ date, name, dkpValue, attendees:string[], attendeeUserIds:string[] }]` — attendees = character names, ids = owner ids. |
| `loadUsers()` | `{ username, usernameId, activeDkp, earned, spent }`. |
| `loadRoster()` | CSV → `{ member, character, cls, level, race, mainAlt, rank, availableDkp, earnedDkp, spentDkp, applied, memberSince }` (dates truncated to `YYYY-MM-DD`). |
| `itemLink(name)`, `escapeHtml(str)` | pqdi.cc anchor with text fallback; escapes `& < > " '`. |

## app.js — views & functions

- **Constants:** `ITEMS_RENDER_CAP=100`; page sizes 25 (recent-loot/standings/loot/roster), 5 (raids); `MEMBER_LOOT_CAP=50`.
- `renderOverview(users, loot, items, raids, roster)` — all five args required. Six stat cards: **Total DKP Available** (Σ activeDkp); **Items Awarded · past week** (loot rows in 7-day window); **Top Spender** (max spent → username); **Active Raiders** (unique attendee owner ids across raids dated within 7 days — counted by owner, multi-char members count once; comes from raids.json because attendance is the only per-raid membership signal); **Avg Raid Size · past 30d**; **Applicants** (roster members whose application date falls in 30-day window). Windows are `YYYY-MM-DD` string comparisons against today − N. Then **Recent Loot** table: loot dated ≤7 days, newest first, 25/page — status line goes to `#recent-loot-status` (**not** `#loot-status`, which belongs to the Loot view).
- `renderItems(items, query)` — case-insensitive substring on NAME; max 100 rows (ID + linked name); debounced (200 ms) on `#item-search`.
- `renderStandings(users)` / `renderStandingsPage(page)` — sort by activeDkp desc, 25/page; rank medals (`rank-1/2/3`) for top 3.
- `renderLoot(loot, items)` / `renderLootPage(page, items)` — full history: dated rows newest-first, undated sunk to bottom; 25/page. `applyLootFilter()` narrows by case-insensitive substring on player/item/raid (debounced `#loot-search`).
- `renderRaids(raids)` / `renderRaidsPage(page)` — newest first (undated last), 5/page: Date/Raid/DKP/Raiders (comma-joined names)/Total.
- `renderRoster(rows)` / `renderRosterPage(page)` — search + rank/mainAlt/class filters (`populateRosterFilters()` fills the selects with unique values, "All …" first); sort via `th.sortable` click (delegated on `thead`; numeric-aware compare, tie-break member → character; toggles `sortDir`); 25/page. Member cell = `.member-link[data-member]`.
- `openMember(member)` — drill-down into `#member`: account from `db.users` (case-insensitive) + characters from `db.roster`; stat cards prefer users.json DKP, fall back to summing roster rows; character chips (`.member-char`); member-scoped loot table capped at 50. Back button → `showView("roster")` and re-activates the Roster nav link.
- Pager builders: four near-identical implementations (`renderStandingsPager`, `renderLootPager`, `renderRosterPager`, `renderRaidsPager`) — prime candidate for one shared helper.

## DOM ids (index.html)

- **Nav:** `.topbar` brand; `.sidebar > .nav-link[data-target]` → `overview | standings | loot | roster | raids`. ⚠ **No nav link targets `#items` or `#member`** — items view is unreachable from the UI; member only via `openMember()`.
- `#overview`: stat cards `#stat-total-dkp`, `#stat-items-awarded`, `#stat-top-earner` (label "Top Spender"), `#stat-raiders`, `#stat-avg-raid-size`, `#stat-new-members` (label "Applicants") + two `.stat-spacer` divs (keep grid item count/widths matching row 1); `#recent-loot-status/table/pager`.
- `#items`: `#item-search`, `#item-count`, `#items-table`.
- `#standings`: `#standings-status/table/pager`.
- `#loot`: `#loot-search`, `#loot-status/table/pager`.
- `#roster`: `#roster-search` (debounced 200 ms), selects `#roster-filter-rank/mainalt/class`, `#roster-status/table/pager`; sortable headers `th.sortable[data-sort]`.
- `#member`: `#member-back/name/available/earned/spent/characters/loot-status/loot-table`.
- `#raids`: `#raids-status/table/pager`.

## DKP semantics

- **Earned** per raid attendance (raid has `raid_dkp_value`); **spent** = Σ `item_dkp_value` on awarded loot; **available** = earned − spent (+ `dkp_adjustments`).
- Joins: `users[].username_id ↔ loot[].character_name / raids[].attendees[].character_name`; `loot[].raid_id ↔ raids[].raid_id`; **loot item ↔ items by name string** (hence the `byName` map).
- `roster-export.csv` duplicates users/roster info in a flatter per-character form; its DKP columns are normalized but not displayed.
- IDs are opaque (UUIDs for loot/raids/users, numeric game ids for items). Data spans 2024-10 → mid-2026 (~1,787 raids / 304 users / 7,284 loot rows); the 7-day windows have live data — trust the data, not expectations.

## Gotchas

- `#items` view has **no sidebar nav link** (likely an oversight).
- `transactions.json` is dead data in the repo.
- Four duplicated pager builders → shared-helper candidate.
- Item↔loot join is name-based; a loot item missing from items.json renders as unlinked text.
- No tests, no package.json, no bundler; only external dependency is PapaParse via CDN.
