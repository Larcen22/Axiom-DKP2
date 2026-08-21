# AGENTS.md — Axiom-DKP2 working rules

## Before you start
- Read `CONTEXT.md` first — it is the source of truth for conventions, data semantics, and owner decisions.
- Baseline before non-trivial changes: `npm test` && `npm run test:e2e`. Both must be green; if red, stop and report instead of fixing blindly.

## Hard rules (owner decisions)
- **Never commit or push.** The user handles all git operations. Your job ends at: changes applied + full suite green + a short report of what changed for the user to commit.
- **Guild data is confidential and gitignored**: `loot.json`, `raids.json`, `users.json`, `roster-export.csv` must never be staged, committed, quoted with real values into docs/tests, or pasted anywhere public (this is a *public* repo). Only `items.json` is committed. Test fixtures use synthetic names only.
- The **Item Search view was deliberately removed** — do not re-add it. `items.json` exists for pqdi.cc link resolution only.

## Data conventions
- When the user re-exports data files, run `npm test` first thing — integrity tests validate the new exports (types, ISO dates, cross-file joins) before anything else is trusted.
- Join keys are strings at the data.js boundary; per-raid joins use exact `raid_id`, **never raid name** (names repeat over time).
- Every displayed date must be plain `YYYY-MM-DD` (`isoDate()` enforces this at load).

## Definition of done
- `npm test` and `npm run test:e2e` fully green.
- `node --check` on every JS file touched.
- `CONTEXT.md` updated whenever a convention, decision, or data semantic changes — it must never drift from the code.
