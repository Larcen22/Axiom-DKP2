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
| `items.json` | Item database for `pqdi.cc` links. |
| `loot.json` | History of awarded items. |
| `raids.json` | Log of all raids and attendance. |
| `users.json` | Account-level DKP and character lists. |
| `roster-export.csv` | Per-character roster and DKP metrics. |
| `transactions.json` | *Unused*. |

## Data flow

```
index.html → PapaParse (CDN), js/data.js (`Data`), js/app.js (IIFE)
data.js: fetch + validate + normalize + Map indexes; shared cached `fetchRaids()` promise
app.js init(): Promise.all([loadItems, loadLoot, loadUsers, loadRaids, loadRoster])
         → render all views, wire nav / pagers / search; module state db = { users, loot, items, roster }
```

## Key Mechanics

- **Date resolution:** Loot rows missing `date` resolve via `raid_id → raids[].date` (truncated `YYYY-MM-DD`).
- **Item links:** `Data.itemLink(name)` joins by **name string** via `byName: Map<lowercase NAME, id>` → `https://www.pqdi.cc/item/{id}`; falls back to plain text.
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
| `loadUsers()` | `{ username, usernameId, activeDkp, earned, spent }`. |
| `loadRoster()` | Parses `roster-export.csv` into character-level objects. |
| `itemLink(name)`, `escapeHtml(str)` | Helpers for pqdi.cc links and HTML safety. |

## app.js — Views & UI

- **Views:** Overview, Standings, Loot, Roster, Raids, Item Search, and Member Detail.
- **Overview Stats:** Active DKP (members seen past 30d), Items (past week), Avg DKP Spent · past week, Top Spender, Active Raiders (past 7d), Avg Raid Size (past 30d), and Applicants (past 30d).
- **Roster:** Features search, filters (Rank, Main/Alt, Class), and sortable headers (`th.sortable`).
- **Member Detail:** Drill-down via `.member-link`. Shows account DKP, character list, and member-scoped loot history.
- **Search:** Debounced (200ms) for Item, Loot, and Roster views.

## DKP Semantics

- **Earned:** Per raid attendance (`raid_dkp_value`).
- **Spent:** Σ `item_dkp_value` from awarded loot.
- **Available:** `earned - spent` (+ manual adjustments).
- **Joins:** 
    - `users[].username_id` ↔ `loot[].character_name` / `raids[].attendees[].character_name`.
    - `loot[].raid_id` ↔ `raids[].raid_id`.
    - `loot item` ↔ `items` by **name string** (via `byName` map).
