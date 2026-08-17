# CONTEXT.md — Axiom-DKP2

**What this is:** A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **"Axiom"**. Displayed app name: **"Axiom DKP Metrics"** (topbar brand + `<title>`; repo dir is still `Axiom-DKP2`). It loads local JSON/CSV data exports (presumably from a DKP tracking system) via `fetch` and renders overview stats, an item database, raider standings, loot history, and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item links go out to the community database **pqdi.cc**.

**How to run:** Must be served over HTTP (`fetch` is blocked on `file://`):
```
npx serve .          # or
python3 -m http.server 8000
```

---

## File Inventory

| File | Size (approx) | Role |
|---|---|---|
| `index.html` | 181 lines | App shell: top nav, sidebar navigation, 5 view sections, footer. Loads PapaParse from CDN + local scripts. |
| `js/data.js` | 188 lines | **Data layer** — fetches/validates/normalizes all local data files; builds lookup indexes. Exposes global `Data` object. |
| `js/app.js` | 309 lines | **Presentation layer** — sidebar nav switching, renders the 5 views from data, pagination for standings/loot/raids, debounced item search. |
| `style.css` | ~280 lines | Dark theme (CSS custom properties in `:root`), grid layout shell, stat cards, tables, rank medals, pagers, responsive. |
| `items.json` | ~1.6 MB | Item database: `{ table: "items", rows: [{ id, NAME }] }` — item IDs + names. |
| `loot.json` | ~2.1 MB | Loot awards: `{ loot: [{ item, character_name, character_id, username_id, raid_id, item_dkp_value, date? }] }` — one entry per item awarded. |
| `raids.json` | ~8.2 MB | Raid log: `{ raids: [{ raid_id, raid_name, date, raid_dkp_value, attendees: [{ username_id, character_name }] }] }` — used for missing loot dates, loot raid names, and the Raid History view. |
| `users.json` | ~318 KB | Raider accounts: `{ users: [{ username, username_discord, username_id, rank, available_dkp, dkp_earned, dkp_spent, dkp_adjustments, characters: [{ name, class, character_id, role, level, race }], ApplicationDate, ... }] }` — per-account DKP balances. |
| `roster-export.csv` | ~77 KB | Guild roster metrics: `MemberName, CharacterName, Class, Level, Race, Main/Alt, Rank, AvailableDKP, EarnedDKP, SpentDKP, ApplicationDate, MembershipDate`. One row per character. |
| `transactions.json` | ~597 KB | Present in the repo but **not loaded by any code** — unused. |
| `.pi/` | — | Editor/agent tooling artifacts (not part of the app). |

---

## Architecture & Data Flow

```
index.html
  ├─ loads: PapaParse (CDN), js/data.js (defines `Data`), js/app.js
  │
  js/data.js (Data)  ──fetch──>  items.json, loot.json, raids.json, users.json (roster-export.csv via loadCsv, unused)
  │      validates shape, normalizes field names, builds Map indexes, resolves dates + raid names
  │
  js/app.js (IIFE)   ──on DOMContentLoaded──>  Promise.all([loadItems, loadLoot, loadUsers, loadRaids])
  │      renders all 5 views, wires nav, pagers (event delegation), and debounced item search
  │
  style.css           ── pure CSS, no JS coupling (incl. .pager / .pager-btn styles)
```

Key design points:

- **Date resolution:** many `loot.json` entries lack a `date`; `Data.loadLoot()` falls back to `loot.raid_id → raids.json raids[].date` (via `loadRaidInfo()`, dates truncated to `YYYY-MM-DD`).
- **Raid name resolution:** `loadLoot()` also joins `raid_id → raid_name` and carries a `raid` field per loot row (rendered in the Overview "Recent Loot" table).
- **Item linking:** `Data.itemLink(name, byName)` maps a loot item name → `items.json` id → `https://www.pqdi.cc/item/{id}` anchor. Falls back to escaped plain text if not in the DB.
- **Security:** `Data.escapeHtml` is applied to all user-data rendered into innerHTML.
- **Render strategy:** Overview recent loot shows first 15 dated rows; item table caps at 100 rendered rows; standings/loot/raids use **client-side pagination** (25 / 25 / 5 rows per page respectively) with a shared pager component.
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
| `loadCsv(url)` | Generic PapaParse wrapper (`download: true`, `header: true`, numeric coercion). **Currently unused by app.js** — available for roster-export.csv or future CSV views. |
| `itemLink(name, byName)` | Returns a safe HTML anchor to pqdi.cc, or escaped text fallback. |
| `escapeHtml(str)` | Escapes `& < > " '`. |

Note: `loadLoot()` and `loadRaids()` each fetch `raids.json` independently (no shared cache) — two ~8 MB fetches per page load.

---

## `js/app.js` — Presentation layer (IIFE, no globals)

Constants: `RECENT_LOOT_COUNT = 15`, `ITEMS_RENDER_CAP = 100`, `STANDINGS_PAGE_SIZE = 25`, `LOOT_PAGE_SIZE = 25`, `RAID_PAGE_SIZE = 5`.

| Function | What it does |
|---|---|
| `setupNav()` | Sidebar `.nav-link` buttons toggle `.active` on themselves and show the matching `#section` (`.view.active`). Sections: `overview`, `standings`, `loot`, `raids` (plus `#items`, which has **no nav link**). |
| `setStat(id, text)` | Helper to fill a stat-card value element. |
| `renderOverview(users, loot, items, raids)` | Fills 4 stat cards: **Total DKP Available** (Σ `activeDkp`), **Items Awarded · past week** (loot rows dated within 7 days of today), **Top Spender** (max `spent` → username), **Active Raiders** (unique attendee names from raids dated within 7 days of today). Then renders the **Recent Loot** table: loot with a resolved date, newest first, top 15; columns Date / Player / Item / **Raid** / DKP Spent; item names linked via `Data.itemLink`. Status line goes to `#recent-loot-status` (NOT `#loot-status`, which belongs to the Loot History view). |
| `renderItems(items, query)` | Filters `items.rows` by case-insensitive substring on `NAME`; renders up to 100 rows as ID + linked name (pqdi.cc). Updates the match-count status line. Called on init and on debounced (200 ms) input of `#item-search`. |
| `renderStandings(users)` / `renderStandingsPage(page)` | Sorts users by `activeDkp` desc; paginates 25/page. Row: rank # (medal classes `rank-1/2/3` for top 3), username, Active DKP (`.dkp-positive`/`.dkp-zero`), Earned, Spent. |
| `renderLoot(loot, items)` / `renderLootPage(page, items)` | Full loot history, dated rows first (newest first), undated sunk to bottom; 25/page. Status line reports total, range, and undated count. |
| `renderRaids(raids)` / `renderRaidsPage(page)` | Full raid log, newest first (undated last); 5/page. Columns: Date / Raid / DKP / Raiders (comma-joined attendee names). |
| `renderStandingsPager` / `renderLootPager` / `renderRaidsPager` | Near-identical pager builders: `‹` / page window (±2 with ellipses) / `›`; `.pager-btn[data-page]` + `.active`/`disabled` states. (Three duplicated implementations — prime candidate for a shared helper.) |
| `init()` | Wires nav; `Promise.all` over the four loaders; renders all five views (`renderOverview(users, loot, items, raids)` — note it needs the 4th `raids` arg for the 7-day Active Raiders stat); attaches delegated pager listeners (once, on the persistent pager containers) + debounced item search; global error fallback into `.panel-status` elements. |

---

## `index.html` — DOM structure (ids used by JS)

- **Nav shell:** `.topbar` (brand + "Axiom · read-only · local data"), `.sidebar > .nav-link[data-target]` → section ids (`overview`, `standings`, `loot`, `raids`), sidebar footer links pqdi.cc.
- **`#overview`:** stat cards `#stat-total-dkp`, `#stat-items-awarded`, `#stat-top-earner` (label reads "Top Spender"), `#stat-raiders`; `#recent-loot-status` (renamed from `#loot-status` to fix a duplicate-id collision with the Loot History view); `#recent-loot-table` (Date / Player / Item / Raid / DKP Spent).
- **`#items`:** `#item-search` input, `#item-count` status, `#items-table` (ID / Item). ⚠ **Not reachable from the sidebar nav** — no `.nav-link` targets `items`.
- **`#standings`:** `#standings-status`; `#standings-table` (# / Raider / Active DKP / Earned / Spent); `#standings-pager`.
- **`#loot`:** `#loot-status` (the *only* element with this id now); `#loot-table` (Date / Player / Item / DKP Spent); `#loot-pager`.
- **`#raids`:** `#raids-status`; `#raids-table` (Date / Raid / DKP / Raiders); `#raids-pager`.
- **Footer:** "Axiom-DKP2 · client-side read-only dashboard · data from local JSON/CSV exports".

---

## `style.css` — notable parts

- **Design tokens** in `:root`: dark palette (`--bg #0d1015`), gold accent `--accent #e0a435`, steel blue `--accent-2 #4fa3e0`, radii, topbar/sidebar dimensions.
- **Layout:** sticky topbar; `.layout` CSS Grid (220 px sidebar + content), max-width 1400 px; responsive collapse.
- **Components:** `.stat-grid`/`.stat-card`, `.panel`, `.table-wrap` tables, `.nav-link`, `.panel-status` (incl. `.error`), `.rank-medal.rank-1/2/3` (gold/silver/bronze tints), `.dkp-positive`/`.dkp-zero`, `.pager`/`.pager-btn`/`.pager-ellipsis`, `.site-footer`.

---

## Data semantics (DKP model)

- **DKP earned** per raid attendance (raid has `raid_dkp_value`); **DKP spent** = sum of `item_dkp_value` on awarded loot; **active/available DKP** = earned − spent (plus `dkp_adjustments`).
- Relationships: `users[].username_id` ↔ `loot[].username_id` / `raids[].attendees[].username_id`; `loot[].raid_id` ↔ `raids[].raid_id`; loot `item` name ↔ `items[]` name (join is by **name string**, not id — which is why `byName` map exists).
- `roster-export.csv` duplicates users/roster info in a flatter per-character form (MemberName = username, CharacterName = character); loaded via the (currently unused) `Data.loadCsv`.
- `transactions.json` is in the repo but referenced by no code.
- IDs are opaque (UUIDs in loot/raids/users, numeric game item ids in items.json). Raid dates span **2024-10-25 → 2026-08-14** (1,787 raids, 304 users, 7,284 loot rows); data is current as of mid-2026, so the Overview 7-day window has live data. Trust the data, not expectations.

## Known gaps / notes

- `#items` view has **no sidebar nav link** — only reachable by manually editing the URL hash / DOM; likely an oversight (nav has Overview / Raider Standings / Loot / Raids).
- ~~Duplicate `id="loot-status"`~~ — **fixed**: Overview panel now uses `#recent-loot-status`; previously the Loot History status line was written into the Overview panel and its own status stayed "Loading…" forever.
- `renderOverview` **requires the `raids` argument** (4th param) for the 7-day Active Raiders stat — calling it with 3 args throws `TypeError` and kills the whole render (this regression occurred during the stat-card rework).
- `Data.loadCsv` + `roster-export.csv` and `transactions.json` are **not used** by any view — infrastructure for a roster section (or dead data).
- `raids.json` is fetched **twice** per load (`loadRaidInfo()` and `loadRaids()`) with no shared cache — ~16 MB of redundant parsing.
- Three nearly identical pager implementations (`renderStandingsPager`, `renderLootPager`, `renderRaidsPager`) — could be one generic helper.
- No tests, no package.json, no bundler. Only external dependency is PapaParse via CDN.
- Item↔loot join is name-based; a loot item not present in `items.json` renders as unlinked text.
- Item table is capped at 100 rendered rows with no pagination (standings/loot/raids are paginated); full datasets (10k+ rows) live in memory as arrays.
