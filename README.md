# Axiom DKP Metrics

A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **Axiom**.

It loads local JSON/CSV data exports via `fetch` and renders overview stats, raider standings, loot history, a roster (with per-member drill-down), and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item names link out to the community database [pqdi.cc](https://www.pqdi.cc). A command palette (**Ctrl+K** or **/**) jumps to any member, character, item, or raid; a service worker makes the app usable offline (last-known-good data).

## Running

The app must be served over HTTP (`fetch` is blocked on `file://`):

```bash
npx serve .          # or
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000` or `http://localhost:8000`).

### Hosting without guild data

The guild exports (`loot.json`, `raids.json`, `users.json`, `roster-export.csv`) are gitignored, so a hosted deployment (e.g. GitHub Pages) only ever has the committed files. The app handles this gracefully: it renders its normal error statuses instead of crashing, and navigation / deep links / browser back still work — but no data is shown until the exports are present next to `index.html`.

## Views

| View | What it shows |
|---|---|
| **Overview** | A full-width Guild Bank panel — one uniform stat row (active DKP · 30d, items awarded · week, avg spend · week, avg raid size · 30d, total available DKP, spend per raid · 90d) with a "last raid N days ago" status line and an all-time earned/spent/net footer (avg spend and avg raid size cards carry 12-week sparklines) — followed by insight panels: most active members (30d) with guild-wide avg attendance % and core-raider count | top spenders (30d), weekly activity chart (raids + DKP spent, 12 weeks), raid-activity heatmap (past year, one cell per day), biggest spends (30d) | recent joiners, active characters by class incl. mains/alts split (30d) | raider trend, recent raids, recent rewards (latest 5 by date from the optional `transactions.json`, full day shown when a single day has more than five); a compact Guild Pulse block in the sidebar (last raid · active members) stays visible on every view |
| **Raider Standings** | All accounts sorted by active DKP, with an earned/spent breakdown and 30D/60D/90D/Lifetime raid attendance as `NN% (attended/total)`; all data columns sortable (raid windows by %), searchable by raider name (paginated); top of page shows a DKP-by-class breakdown — top 5 main characters per class among members active in the past 30 days |
| **Loot** | Full loot history with raid names (deep-linking into Raid detail), newest first, searchable by player / item / raid (paginated) |
| **Roster** | Per-character roster with search, rank/main-alt/class filters, sortable columns (paginated) |
| **Member** | Drill-down (member links in Standings, Roster, Overview panels, and Raid Detail): account DKP, rank, characters, raid attendance %, paginated per-member raid history (raid names deep-link into Raid detail), loot history, and reward history of the account's DKP adjustments |
| **Raid** | Drill-down (click any raid name in Recent Raids or Raid History): attendees grouped by member with their characters, items awarded and total DKP spent for that exact raid (joined on `raid_id`), paginated loot table with owner drill-downs |
| **Raids** | Full raid log with date, DKP value, and attendee list; raid names link to the Raid detail view (paginated) |

## Project structure

```
index.html           App shell: top bar, sidebar nav, view sections
style.css            Import manifest (variables → base → layout → components → views)
css/                 Modular stylesheets: variables/, base/, layout/, components/, views/
js/data.js           Data layer (global `Data`): fetch, validate, normalize, index
js/app.js            Presentation layer: navigation, rendering, pagination, search, command palette
sw.js                Service worker: offline support (app-shell precache + stale-while-revalidate)
items.json           Item database (id + name), used for pqdi.cc links
loot.json            Loot awards: one entry per item awarded
raids.json           Raid log (date, DKP value, attendees)
users.json           Raider accounts with DKP balances and characters
roster-export.csv    Per-character guild roster metrics
transactions.json    Account-level DKP adjustments (achievement/recruit bonuses, manual) — optional file
```

## Data & dependencies

- **Data flow:** `js/data.js` fetches the local data files, validates shapes, normalizes field names, builds lookup indexes, resolves missing loot dates via raid log. `js/app.js` renders everything on `DOMContentLoaded`.
- **DKP model:** DKP is earned per raid attendance (`raid_dkp_value`) and spent on awarded loot (`item_dkp_value`). Active/available DKP = earned − spent (+ adjustments). Item↔loot joins are by name string, not id (which is why a `byName` map exists in `Data`).
- **External dependency:** [PapaParse](https://www.papaparse.com/) via CDN (runtime CSV parsing only).
- **Offline PWA:** `sw.js` precaches the app shell and serves data files + the PapaParse script stale-while-revalidate, so a reload with no network still boots from cached data. Home-screen installable via `manifest.webmanifest` + PNG icons.
- **Dev dependencies** (tests only, never loaded by the app): `vitest`, `papaparse` (CSV parity in unit tests), `@playwright/test`.
- **Security:** all user data rendered into the DOM is HTML-escaped.

## Testing

Three layers, all runnable with plain Node (no browser needed for the first two):

```bash
npm install          # dev deps only; the app itself stays dependency-free
npm test             # unit tests + data integrity checks (Vitest)
npm run test:e2e     # Playwright smoke suite against a local static server
```

| Layer | What it verifies |
|---|---|
| `test/unit/data.test.js` | Data-layer logic with mocked fetch/Papa: item indexing, loot date resolution (own date → raid log fallback), DKP coercion, HTML escaping / XSS safety in `itemLink`, roster CSV mapping, retry-on-failure. |
| `test/integrity/integrity.test.js` | Cross-file consistency of the **real exports** when present locally: required fields, unique IDs, ISO dates, no future raids, loot→raid/user joins, roster↔users username match, per-user spent-DKP exactness and earned-DKP drift bounds, item-name coverage (pqdi.cc linkability). Falls back to `test/fixtures/sample-data/` (a known-good synthetic dataset) when the gitignored exports are absent — e.g. in CI. |
| `test/e2e/app.spec.js` | Loads the real UI over HTTP: no console/page errors, all five nav views switch and render, search/sort/pagination work, member + raid drill-downs open and return to their origin view, hash routing (nav updates the URL, browser back/forward work natively, deep links survive a full reload), item links point at pqdi.cc and character links point at Quarmy, every displayed date is plain YYYY-MM-DD, home-screen manifest/icons are served with correct content types, the command palette opens/searches/navigates, the heatmap renders 364 day-cells, an offline reload boots from the service-worker cache, and the mobile bottom nav stays pinned under iPhone emulation. Serves real data locally, sample dataset in CI (`test/e2e/serve.mjs`). |

CI (`.github/workflows/ci.yml`) runs both jobs on push/PR to `main`.

## Known gaps / limitations

- `transactions.json` is **optional**: when absent (e.g. the hosted GitHub Pages site), the Recent Rewards panel and per-member Reward History show empty states — the file never breaks the app. Balances in `users.json` already include these adjustments.

## File sizes (approximate)

| File | Size | Purpose |
|---|---|---|
| `index.html` | ~415 lines | App shell, top bar, nav, view sections, command palette overlay, footer |
| `style.css` + `css/` | ~730 lines total | Dark theme: variables, base, layout, components (cards/tables/pagination/loading/inputs), views (+ motion, heatmap, palette) |
| `js/data.js` | ~274 lines | Global `Data` object: fetch / validate / normalize |
| `js/app.js` | ~1225 lines | Navigation, view rendering, pagination, search, overview insight panels, command palette |
| `sw.js` | ~75 lines | Service worker: offline support |
| `items.json` | ~1.6 MB | Item database (id + name), pqdi.cc links |
| `loot.json` | ~2.1 MB | Loot awards (player, item, DKP spent) |
| `raids.json` | ~8.2 MB | Raid log (date, DKP value, attendees) |
| `users.json` | 318 KB | Raider accounts with DKP balances |
| `roster-export.csv` | ~77 KB | Per-character roster metrics |
| `transactions.json` | ~597 KB | Account-level DKP adjustments (optional) |
