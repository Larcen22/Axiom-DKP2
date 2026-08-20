# Axiom DKP Metrics

A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **Axiom**.

It loads local JSON/CSV data exports via `fetch` and renders overview stats, raider standings, loot history, a roster (with per-member drill-down), and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item names link out to the community database [pqdi.cc](https://www.pqdi.cc).

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
| **Overview** | Guild-wide stat cards plus insight panels: weekly activity chart (raids + DKP spent, 12 weeks), most active members (30d) with core-raider count, top spenders (30d), biggest spends (30d), active characters by class incl. mains/alts split (30d), recent joiners, raider trend, recent raids |
| **Raider Standings** | All accounts sorted by active DKP, with earned/spent breakdown and 30D/60D/90D/Lifetime raid attendance as `NN% (attended/total)`; all data columns sortable (raid windows by %), searchable by raider name (paginated) |
| **Loot** | Full loot history with raid names, newest first, searchable by player / item / raid (paginated) |
| **Roster** | Per-character roster with search, rank/main-alt/class filters, sortable columns (paginated) |
| **Member** | Drill-down (from Roster or Overview panels): account DKP, rank, characters, raid attendance %, paginated member-scoped loot history |
| **Raids** | Full raid log with date, DKP value, and attendee list (paginated) |

## Project structure

```
index.html           App shell: top bar, sidebar nav, view sections
style.css            Import manifest (variables → base → layout → components → views)
css/                 Modular stylesheets: variables/, base/, layout/, components/, views/
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
- **External dependency:** [PapaParse](https://www.papaparse.com/) via CDN (runtime CSV parsing only).
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
| `test/e2e/app.spec.js` | Loads the real UI over HTTP: no console/page errors, all five nav views switch and render, search filters work, raids pagination advances, member drill-down opens/returns, item links point at pqdi.cc. Serves real data locally, sample dataset in CI (`test/e2e/serve.mjs`). |

CI (`.github/workflows/ci.yml`) runs both jobs on push/PR to `main`.

## Known gaps / limitations

- `transactions.json` (~597KB) is pre-processed: DKP adjustments are already baked into `users.json`. Not loaded directly by the app (already folded into balances).

## File sizes (approximate)

| File | Size | Purpose |
|---|---|---|
| `index.html` | ~326 lines | App shell, top bar, nav, view sections, footer |
| `style.css` + `css/` | ~700 lines total | Dark theme: variables, base, layout, components (cards/tables/pagination/loading/inputs), views |
| `js/data.js` | ~247 lines | Global `Data` object: fetch / validate / normalize |
| `js/app.js` | ~805 lines | Navigation, view rendering, pagination, search, overview insight panels |
| `items.json` | ~1.6 MB | Item database (id + name), pqdi.cc links |
| `loot.json` | ~2.1 MB | Loot awards (player, item, DKP spent) |
| `raids.json` | ~8.2 MB | Raid log (date, DKP value, attendees) |
| `users.json` | 318 KB | Raider accounts with DKP balances |
| `roster-export.csv` | ~77 KB | Per-character roster metrics |
| `transactions.json` | ~597 KB | Pre-processed: account-level adjustments in users.json |
