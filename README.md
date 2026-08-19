# Axiom DKP Metrics

A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **Axiom**.

It loads local JSON/CSV data exports via `fetch` and renders overview stats, an item database, raider standings, loot history, a roster (with per-member drill-down), and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item names link out to the community database [pqdi.cc](https://www.pqdi.cc).

## Running

The app must be served over HTTP (`fetch` is blocked on `file://`):

```bash
npx serve .          # or
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000` or `http://localhost:8000`).

## Views

| View | What it shows |
|---|---|
| **Overview** | Total DKP available, items awarded in the past 7 days, top spender, active raiders; recent loot (past 7 days, paginated) |
| **Item Database** | Full item table with ID + linked name (pqdi.cc links). ⚠ Not yet reachable via sidebar nav. |
| **Raider Standings** | All accounts sorted by active DKP, with earned/spent breakdown (paginated) |
| **Loot** | Full loot history, newest first, searchable by player / item / raid (paginated) |
| **Roster** | Per-character roster with search, rank/main-alt/class filters, sortable columns (paginated) |
| **Member** | Drill-down from the Roster: account DKP, characters, member-scoped loot history |
| **Raids** | Full raid log with date, DKP value, and attendee list (paginated) |

## Project structure

```
index.html           App shell: top bar, sidebar nav, view sections
style.css            Dark theme, layout, components
js/data.js           Data layer (global `Data`): fetch, validate, normalize, index
js/app.js            Presentation layer: navigation, rendering, pagination, search
items.json           Item database (id + name), used for pqdi.cc links
loot.json            Loot awards: one entry per item awarded
raids.json           Raid log (date, DKP value, attendees)
users.json           Raider accounts with DKP balances and characters
roster-export.csv    Per-character guild roster metrics
transactions.json    Pre-processed: account-level DKP adjustments already baked into users.json
```

## Data & dependencies

- **Data flow:** `js/data.js` fetches the local data files, validates shapes, normalizes field names, builds lookup indexes, resolves missing loot dates via raid log. `js/app.js` renders everything on `DOMContentLoaded`.
- **DKP model:** DKP is earned per raid attendance (`raid_dkp_value`) and spent on awarded loot (`item_dkp_value`). Active/available DKP = earned − spent (+ adjustments). Item↔loot joins are by name string, not id (which is why a `byName` map exists in `Data`).
- **External dependency:** [PapaParse](https://www.papaparse.com/) via CDN (CSV parsing only; no npm deps to install).
- **Security:** all user data rendered into the DOM is HTML-escaped.

## Known gaps / limitations

- The **Item Database** view has no sidebar nav link — currently not reachable without manual URL/hash editing.
- `transactions.json` (~597KB) is pre-processed: DKP adjustments are already baked into `users.json`. Not loaded directly by the app (already folded into balances).
- `raids.json` is fetched twice per page load (`loadRaidInfo()` + `loadRaids()`) with no shared cache — ~16 MB of redundant parsing on init.
- Four nearly identical pager implementations exist (`renderStandingsPager`, `renderLootPager`, `renderRosterPager`, `renderRaidsPager`); could be consolidated into a single generic helper.

## File sizes (approximate)

| File | Size | Purpose |
|---|---|---|
| `index.html` | 257 lines | App shell, top bar, nav, view sections, footer |
| `style.css` | ~383 lines | Dark theme, layout, components |
| `js/data.js` | 215 lines | Global `Data` object: fetch / validate / normalize |
| `js/app.js` | 535 lines | Navigation, view rendering, pagination, search |
| `items.json` | ~1.6 MB | Item database (id + name), pqdi.cc links |
| `loot.json` | ~2.1 MB | Loot awards (player, item, DKP spent) |
| `raids.json` | ~8.2 MB | Raid log (date, DKP value, attendees) |
| `users.json` | 318 KB | Raider accounts with DKP balances |
| `roster-export.csv` | ~77 KB | Per-character roster metrics |
| `transactions.json` | ~597 KB | Pre-processed: account-level adjustments in users.json |
