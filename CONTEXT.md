# CONTEXT.md — Axiom-DKP2

**What this is:** A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **"Axiom"**. Displayed app name: **"Axiom DKP Metrics"** (topbar brand + `<title>`; repo dir is still `Axiom-DKP2`). It loads local JSON/CSV data exports (presumably from a DKP tracking system) via `fetch` and renders overview stats, an item database, raider standings, loot history, a roster (with per-member drill-down detail), and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item links go out to the community database **pqdi.cc**.

**How to run:** Must be served over HTTP (`fetch` is blocked on `file://`):
```
npx serve .          # or
python3 -m http.server 8000
```

---

## File Inventory

| File | Size (approx) | Role |
|---|---|---|
| `index.html` | 257 lines | App shell: top nav, sidebar navigation, 7 view sections (Overview / Items / Standings / Loot / Roster / Member / Raids), footer. Loads PapaParse from CDN + local scripts. |
| `js/data.js` | 215 lines | **Data layer** — fetches/validates/normalizes all local data files; builds lookup indexes. Exposes global `Data` object. |
| `js/app.js` | 535 lines | **Presentation layer** — sidebar nav switching, renders the 7 views from data, pagination for standings/loot/roster/raids, member drill-down (`openMember`), debounced item search. |
| `style.css` | ~383 lines | Dark theme (CSS custom properties in `:root`), grid layout shell, stat cards, tables, rank medals, pagers, roster controls, member-detail styles (`.member-back` / `.member-link` / `.member-char`), responsive. |
| `items.json` | ~1.6 MB | Item database: `{ table: "items", rows: [{ id, NAME }] }` — item IDs + names. |
| `loot.json` | ~2.1 MB | Loot awards: `{ loot: [{ item, character_name, character_id, username_id, raid_id, item_dkp_value, date? }] }` — one entry per item awarded. |
| `raids.json` | ~8.2 MB | Raid log: `{ raids: [{ raid_id, raid_name, date, raid_dkp_value, attendees: [{ username_id, character_name }] }] }` — used for missing loot dates, loot raid names, and the Raid History view. |
| `users.json` | ~318 KB | Raider accounts: `{ users: [{ username, username_discord, username_id, rank, available_dkp, dkp_earned, dkp_spent, dkp_adjustments, characters: [{ name, class, character_id, role, level, race }], ApplicationDate, ... }] }` — per-account DKP balances. |
| `roster-export.csv` | ~77 KB | Guild roster metrics: `MemberName, CharacterName, Class, Level, Race, Main/Alt, Rank, AvailableDKP, EarnedDKP, SpentDKP, ApplicationDate, MembershipDate`. One row per character; powers the Roster view via `Data.loadRoster()`. |
| `transactions.json` | ~597 KB | Present in the repo but **not loaded by any code** — unused. |
| `.pi/` | — | Editor/agent tooling artifacts (not part of the app). |

---

## Architecture & Data Flow

```
index.html
  ├─ loads: PapaParse (CDN), js/data.js (defines `Data`), js/app.js
  │
  js/data.js (Data)  ──fetch──>  items.json, loot.json, raids.json, users.json, roster-export.csv (via loadRoster → loadCsv)
  │      validates shape, normalizes field names, builds Map indexes, resolves dates + raid names
  │
  js/app.js (IIFE)   ──on DOMContentLoaded──>  Promise.all([loadItems, loadLoot, loadUsers, loadRaids, loadRoster])
  │      renders all 7 views, wires nav, pagers (event delegation), member drill-down,
  │      and debounced item search
  │
  style.css           ── pure CSS, no JS coupling (incl. .pager / .pager-btn styles)
```

Key design points:

- **Date resolution:** many `loot.json` entries lack a `date`; `Data.loadLoot()` falls back to `loot.raid_id → raids.json raids[].date` (via `loadRaidInfo()`, dates truncated to `YYYY-MM-DD`).
- **Raid name resolution:** `loadLoot()` also joins `raid_id → raid_name` and carries a `raid` field per loot row (rendered in the Overview "Recent Loot" table).
- **Item linking:** `Data.itemLink(name, byName)` maps a loot item name → `items.json` id → `https://www.pqdi.cc/item/{id}` anchor. Falls back to escaped plain text if not in the DB.
- **Security:** `Data.escapeHtml` is applied to all user-data rendered into innerHTML.
- **Render strategy:** Overview recent loot shows all loot dated in the past 7 days, paginated at 25/page; item table caps at 100 rendered rows; recent-loot/standings/loot/roster/raids use **client-side pagination** (25 / 25 / 25 / 25 / 5 rows per page respectively) with a shared pager component.
- **Overview "past 7 days" stats:** `renderOverview()` computes a `YYYY-MM-DD` cutoff (today − 7) and string-compares it against resolved dates. **Items Awarded** = loot rows dated in the window; **Active Raiders** = unique attendee character names across `raids.json` raids dated in the window (attendance is the only per-raid membership signal, so it comes from raids, not users).
- **Pagers:** buttons are re-created on every page render, so click handling uses **event delegation** on the persistent `#*-pager` container (one listener per table, wired once in `init()`).
- **Errors:** any load failure replaces all `.panel-status` elements with a `Failed to load data: ...` message (`.error` class).

---

## `js/data.js` — Data layer (global `Data`)

| Export | What it does |
|---|---|
| `fetchJson(url)` | Internal. `fetch` with `no-cache`; throws on non-OK. |
| `loadItems()` | Loads `items.json`; validates `{ table: "items", rows: [...] }`; skips malformed rows. Returns `{ byId: Map<id, NAME>, byName: Map<lowercase NAME, id>, rows: [...] }`. `byName` is the key for pqdi.cc links. |
| `loadRaidInfo()` | Loads `raids.json`; returns `Map<raid_id, { date: "YYYY-MM-DD" \| null, name: string }>` — used by `loadLoot()` for date + raid-name resolution. |
| `loadLoot()` | Loads `loot.json` + raid info in parallel. Normalizes each entry to `{ date \| null, player, item, raid \| null, dkpSpent }` (date = own date ?? raid date; `dkpSpent` = `item_dkp_value` coerced to Number). |
| `loadRaids()` | Loads `raids.json` fully for the Raid History view: `[{ date, name, dkpValue, attendees: string[] }]` (attendees = character names). |
| `loadUsers()` | Loads `users.json`. Normalizes to `{ username, activeDkp, earned, spent }` (from `available_dkp`, `dkp_earned`, `dkp_spent`). |
| `loadRoster()` | Loads `roster-export.csv` via `loadCsv`; normalizes each row to `{ member, character, cls, level, race, mainAlt, rank, availableDkp, earnedDkp, spentDkp, applied, memberSince }` (dates truncated to `YYYY-MM-DD`). Feeds the Roster view. |
| `loadCsv(url)` | Generic PapaParse wrapper (`download: true`, `header: true`, `skipEmptyLines`, `trimHeaders`, numeric coercion). Used by `loadRoster()`. |
| `itemLink(name, byName)` | Returns a safe HTML anchor to pqdi.cc, or escaped text fallback. |
| `escapeHtml(str)` | Escapes `& < > " '`. |

Note: `loadLoot()` and `loadRaids()` each fetch `raids.json` independently (no shared cache) — two ~8 MB fetches per page load.

---

## `js/app.js` — Presentation layer (IIFE, no globals)

Constants: `ITEMS_RENDER_CAP = 100`, `STANDINGS_PAGE_SIZE = 25`, `LOOT_PAGE_SIZE = 25`, `ROSTER_PAGE_SIZE = 25`, `MEMBER_LOOT_CAP = 50`, `RAID_PAGE_SIZE = 5`. Module-level state: `db = { users, loot, items, roster }` (set in `init()`, used by `openMember()`).

| Function | What it does |
|---|---|
| `setupNav()` | Sidebar `.nav-link` buttons toggle `.active` on themselves and show the matching `#section` (`.view.active`). Sections: `overview`, `standings`, `loot`, `roster`, `raids` (plus `#items` and `#member`, which have **no nav links** — `#member` is reached only via `openMember()`). |
| `setStat(id, text)` | Helper to fill a stat-card value element. |
| `renderOverview(users, loot, items, raids)` | Fills 4 stat cards: **Total DKP Available** (Σ `activeDkp`), **Items Awarded · past week** (loot rows dated within 7 days of today), **Top Spender** (max `spent` → username), **Active Raiders** (unique attendee names from raids dated within 7 days of today). Then renders the **Recent Loot** table: all loot dated within the past 7 days (same window as the Items Awarded stat), newest first, paginated 25/page via `renderRecentLootPage()` / `renderRecentLootPager()` (delegated on `#recent-loot-pager`); columns Date / Player / Item / **Raid** / DKP Spent; item names linked via `Data.itemLink`. Status line goes to `#recent-loot-status` (NOT `#loot-status`, which belongs to the Loot History view). |
| `renderItems(items, query)` | Filters `items.rows` by case-insensitive substring on `NAME`; renders up to 100 rows as ID + linked name (pqdi.cc). Updates the match-count status line. Called on init and on debounced (200 ms) input of `#item-search`. |
| `renderStandings(users)` / `renderStandingsPage(page)` | Sorts users by `activeDkp` desc; paginates 25/page. Row: rank # (medal classes `rank-1/2/3` for top 3), username, Active DKP (`.dkp-positive`/`.dkp-zero`), Earned, Spent. |
| `renderLoot(loot, items)` / `renderLootPage(page, items)` | Full loot history, dated rows first (newest first), undated sunk to bottom; 25/page. `applyLootFilter()` narrows `lootSorted` → `lootFiltered` by case-insensitive substring on player/item/raid (driven by debounced `#loot-search` input). Status line reports total, active query, range, and undated count. |
| `renderRaids(raids)` / `renderRaidsPage(page)` | Full raid log, newest first (undated last); 5/page. Columns: Date / Raid / DKP / Raiders (comma-joined attendee names). |
| `renderRoster(rows)` / `renderRosterPage(page)` | Roster view: stores rows, populates the filter `<select>`s (`populateRosterFilters()`), applies search + rank/mainAlt/class filters and the current sort (`applyRosterFilters()` — sorts by `rosterState.sortKey`, default `member`, toggling `sortDir`; numeric-aware compare, tie-break by member then character), then paginates 25/page. Row: Character / Member / Class · Race (Level) / Main-Alt / Rank / Member Since. The Member cell is a `.member-link` anchor (`href="#member"`, `data-member="<name>"`) that triggers the drill-down. Status line reports filtered/total character count, unique member count, page range. |
| `populateRosterFilters()` | Fills `#roster-filter-rank` / `#roster-filter-mainalt` / `#roster-filter-class` with unique values from the roster ("All …" first option). |
| `applyRosterFilters()` | Filters `rosterAll` by debounced search text (character or member substring), rank, main/alt, class; sorts by the active `rosterState.sortKey`/`sortDir`; result stored in `rosterFiltered`. |
| `showView(id)` | Shared view switcher: removes `.active` from all `.view` sections, adds it to `#id`, scrolls to top. Used by the member drill-down (not the sidebar, which has its own inline switcher). |
| `openMember(member)` | Member detail view (`#member`): looks up the account in `db.users` (case-insensitive) and the member's characters in `db.roster`. Fills `#member-name` + 3 stat cards (`#member-available` / `#member-earned` / `#member-spent` — prefers users.json account DKP, falls back to summing the roster rows). Renders `#member-characters` chips (`.member-char`: name · class (level) · main/alt) and a member-scoped loot table (`#member-loot-table`, Date / Character / Item / Raid / DKP Spent) filtered to the member's character names, dated-first sort, capped at `MEMBER_LOOT_CAP = 50` with a count line in `#member-loot-status`. Ends with `showView("member")`. |
| `renderStandingsPager` / `renderLootPager` / `renderRosterPager` / `renderRaidsPager` | Near-identical pager builders: `‹` / page window (±2 with ellipses) / `›`; `.pager-btn[data-page]` + `.active`/`disabled` states. (Four duplicated implementations — prime candidate for a shared helper.) |
| `init()` | Wires nav; `Promise.all` over the five loaders (`loadItems, loadLoot, loadUsers, loadRaids, loadRoster`); renders all six views (`renderOverview(users, loot, items, raids)` — note it needs the 4th `raids` arg for the 7-day Active Raiders stat); stores `db = { users, loot, items, roster }` for the drill-down; attaches delegated pager listeners (once, on the persistent pager containers: `#recent-loot-pager`, `#standings-pager`, `#loot-pager`, `#roster-pager`, `#raids-pager`); wires roster controls (debounced 200 ms `#roster-search` input, `change` on the three filter selects, delegated click on `#roster-table thead` `th.sortable` → toggle sort key/dir); wires member drill-down (delegated click on `#roster-table tbody` for `.member-link` → `openMember`, plus `#member-back` → `showView("roster")` and re-activates the Roster nav link) + debounced (200 ms) item search; global error fallback into `.panel-status` elements. |

---

## `index.html` — DOM structure (ids used by JS)

- **Nav shell:** `.topbar` (brand + "Axiom · read-only · local data"), `.sidebar > .nav-link[data-target]` → section ids (`overview`, `standings`, `loot`, `roster`, `raids`), sidebar footer links pqdi.cc.
- **`#overview`:** stat cards `#stat-total-dkp`, `#stat-items-awarded`, `#stat-top-earner` (label reads "Top Spender"), `#stat-raiders`; `#recent-loot-status` (renamed from `#loot-status` to fix a duplicate-id collision with the Loot History view); `#recent-loot-table` (Date / Player / Item / Raid / DKP Spent); `#recent-loot-pager` (25/page, delegated click).
- **`#items`:** `#item-search` input, `#item-count` status, `#items-table` (ID / Item). ⚠ **Not reachable from the sidebar nav** — no `.nav-link` targets `items`.
- **`#standings`:** `#standings-status`; `#standings-table` (# / Raider / Active DKP / Earned / Spent); `#standings-pager`.
- **`#loot`:** `.roster-controls` with `#loot-search` input (debounced 200 ms, filters by player/item/raid); `#loot-status` (the *only* element with this id now); `#loot-table` (Date / Player / Item / DKP Spent); `#loot-pager`.
- **`#roster`:** `.roster-controls` with `#roster-search` input (debounced 200 ms) + three `<select>` filters (`#roster-filter-rank`, `#roster-filter-mainalt`, `#roster-filter-class` — populated by `populateRosterFilters()`); `#roster-status`; `#roster-table` (Character / Member / Class · Race / Main-Alt / Rank / Member Since) with `th.sortable[data-sort]` headers (click toggles sort via delegated handler on the `thead`); Member cell links are `.member-link[data-member]`; `#roster-pager`.
- **`#member`:** `#member-back` ("← Back to Roster" button), `#member-name` heading, stat cards `#member-available` / `#member-earned` / `#member-spent`, `#member-characters` (`.member-char` chips), `#member-loot-status`, `#member-loot-table` (Date / Character / Item / Raid / DKP Spent). No nav link — shown via `openMember()` / `showView("member")`.
- **`#raids`:** `#raids-status`; `#raids-table` (Date / Raid / DKP / Raiders); `#raids-pager`.
- **Footer:** "Axiom-DKP2 · client-side read-only dashboard · data from local JSON/CSV exports".

---

## `style.css` — notable parts

- **Design tokens** in `:root`: dark palette (`--bg #0d1015`), gold accent `--accent #e0a435`, steel blue `--accent-2 #4fa3e0`, radii, topbar/sidebar dimensions.
- **Layout:** sticky topbar; `.layout` CSS Grid (220 px sidebar + content), max-width 1400 px; responsive collapse.
- **Components:** `.stat-grid`/`.stat-card`, `.panel`, `.table-wrap` tables, `.nav-link`, `.panel-status` (incl. `.error`), `.rank-medal.rank-1/2/3` (gold/silver/bronze tints), `.dkp-positive`/`.dkp-zero`, `.pager`/`.pager-btn`/`.pager-ellipsis`, `.roster-controls`/`#roster-search`/`.roster-filter`/`th.sortable`, `.site-footer`.

---

## Data semantics (DKP model)

- **DKP earned** per raid attendance (raid has `raid_dkp_value`); **DKP spent** = sum of `item_dkp_value` on awarded loot; **active/available DKP** = earned − spent (plus `dkp_adjustments`).
- Relationships: `users[].username_id` ↔ `loot[].username_id` / `raids[].attendees[].username_id`; `loot[].raid_id` ↔ `raids[].raid_id`; loot `item` name ↔ `items[]` name (join is by **name string**, not id — which is why `byName` map exists).
- `roster-export.csv` duplicates users/roster info in a flatter per-character form (MemberName = username, CharacterName = character); loaded via `Data.loadRoster()` and rendered in the Roster view (DKP columns are normalized but **not displayed** — the table shows identity/class/rank/seniority only).
- `transactions.json` is in the repo but referenced by no code.
- IDs are opaque (UUIDs in loot/raids/users, numeric game item ids in items.json). Raid dates span **2024-10-25 → 2026-08-14** (1,787 raids, 304 users, 7,284 loot rows); data is current as of mid-2026, so the Overview 7-day window has live data. Trust the data, not expectations.

## Known gaps / notes

- `#items` view has **no sidebar nav link** — only reachable by manually editing the URL hash / DOM; likely an oversight (nav has Overview / Raider Standings / Loot / Roster / Raids).
- ~~Roster controls are dead UI~~ — **fixed**: `#roster-search` (debounced), the three filter `<select>`s (populated by `populateRosterFilters()`), and the `th.sortable` headers (delegated sort toggle) are all wired in `app.js` (`applyRosterFilters()` + `init()` listeners).
- ~~Duplicate `id="loot-status"`~~ — **fixed**: Overview panel now uses `#recent-loot-status`; previously the Loot History status line was written into the Overview panel and its own status stayed "Loading…" forever.
- `renderOverview` **requires the `raids` argument** (4th param) for the 7-day Active Raiders stat — calling it with 3 args throws `TypeError` and kills the whole render (this regression occurred during the stat-card rework).
- `transactions.json` is in the repo but referenced by no code (dead data).
- `raids.json` is fetched **twice** per load (`loadRaidInfo()` and `loadRaids()`) with no shared cache — ~16 MB of redundant parsing.
- Four nearly identical pager implementations (`renderStandingsPager`, `renderLootPager`, `renderRosterPager`, `renderRaidsPager`) — could be one generic helper.
- No tests, no package.json, no bundler. Only external dependency is PapaParse via CDN.
- Item↔loot join is name-based; a loot item not present in `items.json` renders as unlinked text.
- Item table is capped at 100 rendered rows with no pagination (standings/loot/raids are paginated); full datasets (10k+ rows) live in memory as arrays.
