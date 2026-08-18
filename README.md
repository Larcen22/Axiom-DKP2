# Axiom DKP Metrics

A read-only, fully client-side web dashboard for **EverQuest raid DKP** (Dragon Kill Points) accounting for the guild **Axiom**.

It loads local JSON/CSV data exports via `fetch` and renders overview stats, an item database, raider standings, loot history, a roster (with per-member drill-down), and raid history. No server, no build step, no framework — plain HTML/CSS/JS. Item names link out to the community database [pqdi.cc](https://www.pqdi.cc).

## Running

The app must be served over HTTP (`fetch` is blocked on `file://`):

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000` or `http://localhost:8000`).

## Views

| View | What it shows |
|---|---|
| **Overview** | Total DKP available, items awarded in the past 7 days, top spender, active raiders; recent loot (past 7 days, paginated) |
| **Raider Standings** | All accounts sorted by active DKP, with earned/spent breakdown (paginated) |
| **Loot** | Full loot history, newest first, searchable by player / item / raid (paginated) |
| **Roster** | Per-character roster with search, rank/main-alt/class filters, sortable columns (paginated) |
| **Member** | Drill-down from the Roster: account DKP, characters, member-scoped loot history |
| **Raids** | Full raid log with date, DKP value, and attendee list (paginated) |

## Project structure

```
index.html          App shell: top bar, sidebar nav, view sections
style.css           Dark theme, layout, components
js/data.js          Data layer (global `Data`): fetch, validate, normalize, index
js/app.js           Presentation layer: navigation, view rendering, pagination, search
items.json          Item database (id + name), used for pqdi.cc links
loot.json           One entry per item awarded (player, item, DKP spent, raid)
raids.json          Raid log (date, DKP value, attendees)
users.json          Raider accounts with DKP balances and characters
roster-export.csv   Per-character guild roster metrics
transactions.json   Present in the repo but not used by the app
```

## Data & dependencies

- **Data flow:** `js/data.js` fetches the local data files, normalizes field names, builds lookup indexes, and resolves missing loot dates via the raid log. `js/app.js` renders everything on `DOMContentLoaded`.
- **DKP model:** DKP is earned per raid attended and spent on awarded loot; active/available DKP = earned − spent (+ adjustments).
- **External dependency:** [PapaParse](https://www.papaparse.com/) via CDN (CSV parsing only).
- **Security:** all user data rendered into the DOM is HTML-escaped.
