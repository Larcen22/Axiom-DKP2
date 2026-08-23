// @ts-check
/**
 * E2E smoke tests — load the real dashboard over HTTP and verify:
 *   - no JS console/page errors on load
 *   - every nav view switches and renders (no "Loading…" / error states)
 *   - search, pagination, and member drill-down actually work
 *   - item links point at pqdi.cc
 *
 * One shared page across the serial suite: the app fetches ~12 MB of JSON on
 * load, so re-navigating per test would be wasteful.
 */
const { test, expect, devices } = require("@playwright/test");

test.describe.serial("Axiom DKP dashboard", () => {
  let page;
  const errors = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("favicon")) errors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto("/");
    // init() renders every view once Promise.all([...loads]) resolves;
    // standings rows are the completion signal.
    await expect(page.locator("#standings-table tbody tr")).not.toHaveCount(0);
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  const goTo = async (target) => {
    await page.click(`.nav-link[data-target="${target}"]`);
    await expect(page.locator(`#${target}.view.active`)).toBeVisible();
  };

  test("loads without JS errors or failed data loads", async () => {
    await expect(page.locator(".panel-status.error")).toHaveCount(0);
    // Give late-arriving errors a moment to surface.
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("home-screen manifest and icons are served", async () => {
    // The PWA manifest must load with the right content type.
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBeTruthy();
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    const body = await manifest.json();
    expect(body.name).toBe("Axiom DKP Metrics");
    for (const icon of ["icon-192.png", "icon-512.png"]) {
      const res = await page.request.get(`/${icon}`);
      expect(res.ok(), `${icon} should be served`).toBeTruthy();
      expect(res.headers()["content-type"]).toContain("image/png");
    }
    // index.html must reference the manifest + apple-touch-icon.
    const html = await page.content();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  test("overview stat cards are populated", async () => {
    for (const id of ["stat-total-dkp", "stat-items-awarded", "stat-avg-spent-week",
      "stat-avg-raid-size"]) {
      const text = await page.locator(`#${id}`).textContent();
      expect(text, `#${id} should be populated`).not.toMatch(/^Loading/);
    }
    // Total DKP is a plain number (or 0), never an error string.
    await expect(page.locator("#stat-total-dkp")).toHaveText(/^(?:[\d,]+|–)$/);

    // Every bank card carries a 12-week sparkline; it renders whenever the stat has
    // real data (skipped for "–"/0 so stale fixture dates in future CI runs don't rot).
    const sparkPairs = [
      ["stat-total-dkp", "spark-active-dkp"],
      ["stat-items-awarded", "spark-items"],
      ["stat-avg-spent-week", "spark-spent"],
      ["stat-avg-raid-size", "spark-size"],
      ["bank-total", "spark-bank"],
      ["bank-burn", "spark-burn"],
    ];
    for (const [statId, sparkId] of sparkPairs) {
      const val = (await page.locator(`#${statId}`).textContent()).trim();
      if (!val.startsWith("–") && val !== "0") {
        expect(await page.locator(`#${sparkId} svg.spark-svg`).count(), `${sparkId} should render`).toBe(1);
      }
    }

    // Panel cascade: init() assigns a stagger index to every overview panel.
    const idx = await page.locator("#overview .panel").first().evaluate((el) => el.style.getPropertyValue("--i"));
    expect(idx, "first overview panel should have --i set").toBe("0");

    // The initial skeleton state must have been cleared once data loaded.
    const bodyClass = await page.locator("body").getAttribute("class");
    expect(bodyClass ?? "", "app-loading should be removed after init").not.toContain("app-loading");
  });

  test("guild bank cards link to 52-week trend drill-downs", async () => {
    await page.goto("/#/overview");
    // One real click: Available DKP card → its trend view.
    await page.click("#bank-total");
    await expect(page).toHaveURL(/#\/trend\/bank-total$/);
    await expect(page.locator("#trend-title")).toContainText("Available DKP");
    expect(await page.locator("#trend-chart .activity-bar").count()).toBe(52);
    expect(await page.locator("#trend-stats .stat-card").count()).toBe(4);

    // Every other card's target renders too (deep links).
    for (const [key, title] of [
      ["active-dkp", "Active Members"],
      ["items", "Items Awarded"],
      ["spent", "DKP Spent per Week"],
      ["size", "Average Raid Size"],
      ["burn", "DKP Spent per Raid"],
    ]) {
      await page.evaluate((h) => { location.hash = h }, `#/trend/${key}`);
      await expect(page.locator("#trend-title")).toContainText(title);
      expect(await page.locator("#trend-chart .activity-bar").count()).toBe(52);
      expect(await page.locator("#trend-stats .stat-card").count()).toBe(4);
    }

    // Back returns to the previous view.
    await page.evaluate(() => { location.hash = "#/overview"; });
    await expect(page).toHaveURL(/#\/overview$/);
    await page.click("#bank-total");
    await expect(page).toHaveURL(/#\/trend\/bank-total$/);
    await page.click("#trend-back");
    await expect(page).toHaveURL(/#\/overview$/);
  });

  test("every nav view switches and renders content", async () => {
    const targets = await page.locator(".nav-link").evaluateAll((links) => links.map((l) => l.dataset.target));
    expect(targets).toEqual(expect.arrayContaining(["overview", "standings", "loot", "roster", "raids"]));

    for (const t of targets) {
      await goTo(t);
      // The view's status line must have left its initial "Loading…" state.
      const statusId = { overview: "recent-raids-status" }[t] || `${t}-status`;
      const status = page.locator(`#${statusId}`);
      await expect(status).not.toHaveText(/Loading/);
      // Hash routing: the URL reflects the active view.
      await expect(page).toHaveURL(new RegExp("#" + "/" + t + "$"));
    }
  });

  test("data tables contain rows", async () => {
    for (const id of ["standings-table", "loot-table", "roster-table", "raids-table", "recent-raids-table"]) {
      await expect(page.locator(`#${id} tbody tr`), `#${id} should have rows`).not.toHaveCount(0);
    }
  });

  test("standings shows raid windows and searches by raider", async () => {
    await goTo("standings");
    const headers = await page.locator("#standings-table thead th").allTextContents();
    expect(headers).toEqual(["#", "Raider", "Active DKP", "Earned", "Spent", "30D", "60D", "90D", "Lifetime"]);

    // Raid-window cells are "NN% (attended/total)" or "–" when no raids in the window.
    const firstRow = page.locator("#standings-table tbody tr:first-child");
    // Columns 6-9: 30D, 60D, 90D, Lifetime.
    const windows = [];
    for (let col = 6; col <= 9; col++) {
      windows.push((await firstRow.locator(`td:nth-child(${col})`).textContent()).trim());
    }
    expect(windows).toHaveLength(4);
    for (const cell of windows) {
      expect(cell.trim()).toMatch(/^(?:\d+% \(\d+\/\d+\)|–)$/);
    }

    const raider = (await page.locator("#standings-table tbody tr:first-child td:nth-child(2)").textContent()).trim();
    await page.fill("#standings-search", raider);
    await expect(page.locator("#standings-status")).toContainText(/matching/);
    const rows = await page.locator("#standings-table tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(1);
    for (const cell of await page.locator("#standings-table tbody td:nth-child(2)").allTextContents()) {
      expect(cell.trim()).toContain(raider);
    }

    await page.fill("#standings-search", "");
    await expect(page.locator("#standings-status")).not.toContainText(/matching/);
  });

  test("standings columns are sortable (raid windows by percentage)", async () => {
    const col = (n) => page.locator(`#standings-table tbody td:nth-child(${n})`);
    const nums = async (n) => (await col(n).allTextContents()).map((t) => Number(t.replace(/,/g, "")));

    // Earned (column 4): first click sorts biggest-first with a ↓ indicator.
    await page.click('#standings-table th[data-sort="earned"]');
    const earnedDesc = await nums(4);
    expect(earnedDesc.length).toBeGreaterThan(0);
    for (let i = 1; i < earnedDesc.length; i++) expect(earnedDesc[i - 1]).toBeGreaterThanOrEqual(earnedDesc[i]);
    await expect(page.locator('#standings-table th[data-sort="earned"]')).toHaveClass(/sorted-desc/);

    // Second click flips to ascending with a ↑ indicator.
    await page.click('#standings-table th[data-sort="earned"]');
    const earnedAsc = await nums(4);
    for (let i = 1; i < earnedAsc.length; i++) expect(earnedAsc[i - 1]).toBeLessThanOrEqual(earnedAsc[i]);
    await expect(page.locator('#standings-table th[data-sort="earned"]')).toHaveClass(/sorted-asc/);

    // 30D: sorts by the percentage number, descending; "–" rows sink to the bottom.
    await page.click('#standings-table th[data-sort="p30"]');
    const pcts = (await col(6).allTextContents()).map((t) => {
      t = t.trim();
      return t === "\u2013" ? null : Number(t.match(/^(\d+)%/)[1]);
    });
    for (let i = 0; i < pcts.length - 1; i++) {
      if (pcts[i] == null) expect(pcts.slice(i + 1).every((v) => v == null)).toBeTruthy(); // "\u2013" only at the tail
      else if (pcts[i + 1] != null) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i + 1]);
    }

    // Restore the default sort (active DKP, biggest first).
    await page.click('#standings-table th[data-sort="activeDkp"]');
    const dkp = await nums(3);
    for (let i = 1; i < dkp.length; i++) expect(dkp[i - 1]).toBeGreaterThanOrEqual(dkp[i]);
  });

  test("standings shows top-5 DKP per class for active members", async () => {
    await goTo("standings");
    const status = page.locator("#class-dkp-status");
    await expect(status).not.toHaveText(/Loading/);

    // Dataset/time-agnostic: either classes render, or the explicit empty state.
    if (/(characters|members)/i.test(await status.textContent())) {
      const cards = page.locator(".class-dkp-card");
      expect(await cards.count()).toBeGreaterThanOrEqual(1);
      for (const card of await cards.all()) {
        // Class header names a class and its total character count.
        expect((await card.locator(".class-dkp-head span:first-child").textContent()).trim()).not.toBe("");
        const rows = card.locator(".class-dkp-list li");
        const n = await rows.count();
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(5); // top 5 only
        for (const t of await rows.allTextContents()) {
          expect(t.trim()).toMatch(/\d/); // every row carries a DKP amount
        }
      }

      // Metric toggle: Spent re-sorts every class list by spent DKP.
      await page.click("#cdk-mode-spent");
      await expect(status).toContainText("sorted by Spent DKP");
      for (const card of await cards.all()) {
        const vals = (await card.locator(".cdk-val").allTextContents()).map((t) => Number(t.replace(/[^\d]/g, "")));
        expect(vals.length).toBeGreaterThanOrEqual(1);
        for (let i = 1; i < vals.length; i++) expect(vals[i - 1]).toBeGreaterThanOrEqual(vals[i]);
      }
      // Back to the default metric.
      await page.click("#cdk-mode-available");
      await expect(status).toContainText("sorted by Available DKP");
    } else {
      await expect(status).toContainText("No members seen on raids in the past 30 days");
      await expect(page.locator(".class-dkp-card")).toHaveCount(0);
    }
  });

  test("overview shows guild bank stats", async () => {
    // Guild Bank panel: total is always numeric (users carry DKP); burn is
    // either a value or "–" when the dataset has no recent raids.
    await goTo("overview");
    const status = page.locator("#bank-status");
    await expect(status).not.toHaveText(/Loading/);
    // "Last raid N days ago" prefix (both datasets carry dated raids).
    await expect(status).toHaveText(/^Last raid (today|yesterday|\d+ days ago) · /);
    await expect(page.locator("#bank-total")).toHaveText(/^[\d,]+$/);
    await expect(page.locator("#bank-burn")).toHaveText(/^(?:[\d,]+|–)$/);
    await expect(page.locator("#bank-flow")).toContainText("earned");
  });

  test("recent rewards panel shows the latest rewards with plain dates", async () => {
    const st = (await page.locator("#recent-transactions-status").textContent()) || "";
    expect(st).not.toContain("Loading");
    expect(st).toMatch(/^(?:Last \d+ of [\d,]+ rewards|No rewards recorded)/);
    if (await page.locator("#recent-transactions-table").isVisible()) {
      const m = /^Last (\d+) of/.exec(st);
      expect(m, "status should report the shown count").not.toBeNull();
      const rows = await page.locator("#recent-transactions-table tbody tr").count();
      expect(rows).toBe(Number(m[1])); // rendered rows match the status line
      if (rows > 5) {
        // Day expansion: extra rows only appear when a single day has more than five rewards,
        // so every displayed row must share that one date.
        const dates = await page.locator("#recent-transactions-table tbody td:nth-child(1)").allTextContents();
        expect(new Set(dates.map((d) => d.trim())).size).toBe(1);
      }
      // Full ISO timestamps in the export must render as plain YYYY-MM-DD.
      for (const t of await page.locator("#recent-transactions-table tbody td:nth-child(1)").allTextContents()) {
        expect(t.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  test("all displayed dates are plain YYYY-MM-DD", async () => {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    // Loot view (page 1) — the sample dataset includes a full-ISO-timestamp row.
    await goTo("loot");
    for (const t of await page.locator("#loot-table tbody td:nth-child(1)").allTextContents()) {
      expect(t.trim()).toMatch(DATE_RE);
    }

    // Raids view (page 1).
    await goTo("raids");
    for (const t of await page.locator("#raids-table tbody td:nth-child(1)").allTextContents()) {
      expect(t.trim()).toMatch(DATE_RE);
    }

    // Member detail join-date label. The route renders in the hashchange task right
    // after the click, so use retrying expectations (a raw textContent read would race it).
    await goTo("roster");
    await page.click("#roster-table tbody tr:first-child .member-link");
    await expect(page.locator("#member.view.active")).toBeVisible();
    await expect(page.locator("#member-raids-since-label")).toHaveText(/^(?:since \d{4}-\d{2}-\d{2}$|\(no join date\))$/);
  });

  test("overview insight panels render", async () => {
    // Activity chart always renders exactly ACTIVITY_WEEKS week-groups (zero-weeks included).
    await expect(page.locator("#activity-chart .week-group")).toHaveCount(12);
    // Raider trend: one bar per week.
    await expect(page.locator("#raider-chart .activity-bar")).toHaveCount(12);
    for (const id of ["most-active-status", "top-spenders-status", "biggest-spends-status", "class-comp-status", "recent-joiners-status", "raider-trend-status"]) {
      await expect(page.locator(`#${id}`), `${id} should leave Loading state`).not.toHaveText(/Loading/);
    }
    // The 30-day join count (formerly the Applicants stat card) lives in this status line.
    await expect(page.locator("#recent-joiners-status")).toHaveText(/joined in the past 30 days/);
    // Guild-wide avg 30d attendance headline (both datasets have active members).
    await expect(page.locator("#most-active-status")).toHaveText(/Avg 30d attendance \d+% · /);

    // Sidebar guild pulse: last-raid recency + active/total members.
    await expect(page.locator("#pulse-last-raid")).toHaveText(/^(today|yesterday|\d+ days ago)$/);
    await expect(page.locator("#pulse-active")).toHaveText(/^\d+(,\d{3})* \/ \d+(,\d{3})*$/);
    // The pulse lives in the sidebar, so it persists across views.
    await goTo("standings");
    await expect(page.locator("#guild-pulse")).toBeVisible();
  });

  test("loot search filters by player name", async () => {
    await goTo("loot");
    const player = (await page.locator("#loot-table tbody tr:first-child td:nth-child(2)").textContent()).trim();
    expect(player).not.toBe("");

    await page.fill("#loot-search", player);
    await expect(page.locator("#loot-status")).toContainText(/matching/);
    // Every visible row must mention the searched player (or item/raid match).
    const rowCount = await page.locator("#loot-table tbody tr").count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    await page.fill("#loot-search", "");
    await expect(page.locator("#loot-status")).not.toContainText(/matching/);
  });

  test("footer shows data-as-of date + freshness state", async () => {
    // "Data updated YYYY-MM-DD HH:MM" — newest Last-Modified across the loaded data
    // files (when the latest export was deployed; serve.mjs sends it like GitHub Pages)
    // — or the "Data through <newest raid date>" fallback, plus the freshness suffix
    // ("· fresh" online, "· cached (offline)" when served from the SW cache).
    await expect(page.locator("#data-asof")).toHaveText(
      /^(Data updated \d{4}-\d{2}-\d{2} \d{2}:\d{2}|Data through \d{4}-\d{2}-\d{2}) · (fresh|cached \(offline\))$/
    );
  });

  test("loot history raid names link to raid detail", async () => {
    await goTo("loot");
    const link = page.locator("#loot-table tbody tr:first-child .raid-link").first();
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toMatch(/^#\/raid\//);
    await link.click();
    // Native anchor navigation: hashchange fires as a separate task — retrying assertion.
    await expect(page.locator("#raid.view.active")).toHaveCount(1);
  });

  test("raids pagination advances pages", async () => {
    await goTo("raids");
    // CI's sample dataset can fit on a single page — nothing to paginate then.
    const total = Number(/\(page \d+ of (\d+)\)/.exec((await page.locator("#raids-status").textContent()) || "")?.[1] ?? 0);
    if (total < 2) {
      test.skip(true, `dataset fits on one page (${total}) — nothing to paginate`);
      return;
    }

    // Compare the whole row: adjacent raids can share a date.
    const firstBefore = (await page.locator("#raids-table tbody tr:first-child").innerText()).replace(/\s+/g, " ");
    await expect(page.locator("#raids-pager")).toBeVisible(); // 1700+ raids -> many pages

    await page.locator("#raids-pager .pager-btn").last().click(); // "next"
    await expect(page.locator("#raids-status")).toContainText(/\(page 2 of/);
    const firstAfter = (await page.locator("#raids-table tbody tr:first-child").innerText()).replace(/\s+/g, " ");
    expect(firstAfter, "first row should change after paging").not.toBe(firstBefore);

    await page.locator("#raids-pager .pager-btn").first().click(); // "prev" back to 1
    await expect(page.locator("#raids-status")).toContainText(/\(page 1 of/);
  });

  test("raids search filters by raid name or attendee", async () => {
    await goTo("raids");
    const before = await page.locator("#raids-table tbody tr").count();
    // Search a full raid name from the first row (names repeat over time in real data — every
    // matching row must still contain it).
    const name = (await page.locator("#raids-table tbody tr:first-child .raid-link").textContent()).trim();

    await page.fill("#raids-search", name);
    await expect(page.locator("#raids-status")).toContainText(/matching/);
    const after = await page.locator("#raids-table tbody tr").count();
    expect(after).toBeGreaterThanOrEqual(1);
    for (const t of await page.locator("#raids-table tbody tr").allTextContents()) {
      expect(t.toLowerCase()).toContain(name.toLowerCase());
    }

    // Clearing restores the full list.
    await page.fill("#raids-search", "");
    await expect(page.locator("#raids-status")).not.toContainText(/matching/);
    await expect(await page.locator("#raids-table tbody tr").count()).toBe(before);
  });

  test("roster hides members without recent raids by default", async () => {
    await goTo("roster");
    const box = page.locator("#roster-hide-inactive");
    // On by default: at most the full roster is visible.
    await expect(box).toBeChecked();
    const shownOfTotal = async () => {
      const m = /(\d[\d,]*) of (\d[\d,]*) characters/.exec((await page.locator("#roster-status").textContent()) || "");
      return [Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, ""))];
    };
    let shown = (await shownOfTotal())[0];
    const total = (await shownOfTotal())[1];
    expect(shown).toBeLessThanOrEqual(total);

    // Unchecking removes the filter — every character is visible again.
    await box.uncheck();
    [shown] = await shownOfTotal();
    expect(shown).toBe(total);

    // Re-checking hides inactive members again (restores default state for later tests).
    await box.check();
    [shown] = await shownOfTotal();
    expect(shown).toBeLessThanOrEqual(total);
  });

  test("member drill-down opens detail and back returns to origin", async () => {
    await goTo("roster");
    const link = page.locator("#roster-table tbody tr:first-child .member-link");
    const memberName = (await link.textContent()).trim();

    await link.click();
    await expect(page.locator("#member.view.active")).toBeVisible();
    await expect(page.locator("#member-name")).toHaveText(memberName);
    for (const id of ["member-available", "member-earned", "member-spent"]) {
      await expect(page.locator(`#${id}`)).toHaveText(/^(?:[\d,]+|–)$/);
    }
    // Attendance stats: attended is always a count; since-joined may be "–" without dates.
    await expect(page.locator("#member-raids-attended")).toHaveText(/^\d+$/);
    await expect(page.locator("#member-raids-since")).toHaveText(/^(?:[\d,]+|–)$/);
    // Attendance % windows: integer percent, or "–" when no raids fall in the window.
    for (const id of ["member-att-30", "member-att-60", "member-att-90", "member-att-lifetime"]) {
      await expect(page.locator(`#${id}`)).toHaveText(/^(?:\d+%|–)$/);
    }

    // Character names link out to Quarmy (non-www host) in a new tab — roster cell and profile chip.
    const firstCharCell = page.locator("#roster-table tbody tr:first-child td:nth-child(1) .char-link");
    await expect(firstCharCell).toHaveAttribute("href", /^https:\/\/quarmy\.com\/public\?q=.+/);
    await expect(firstCharCell).toHaveAttribute("target", "_blank");
    const profileChar = page.locator("#member-characters .char-link").first();
    if (await profileChar.count()) {
      await expect(profileChar).toHaveAttribute("href", /^https:\/\/quarmy\.com\/public\?q=.+/);
      await expect(profileChar).toHaveAttribute("target", "_blank");
    }

    // Raid history mirrors the loot table: status always resolves; rows exist iff raids were attended.
    const rs = (await page.locator("#member-raids-status").textContent()) || "";
    expect(rs).not.toContain("Loading");
    expect(rs).toMatch(/^(?:\d+ raids attended|No raid attendance)/);
    if (await page.locator("#member-raids-table").isVisible()) {
      expect(await page.locator("#member-raids-table tbody tr").count()).toBeGreaterThan(0);
    }

    // Reward history mirrors the other tables: status always resolves; rows exist iff rewards found.
    const ts = (await page.locator("#member-tx-status").textContent()) || "";
    expect(ts).not.toContain("Loading");
    expect(ts).toMatch(/^(?:\d+ rewards|No rewards)/);
    if (await page.locator("#member-tx-table").isVisible()) {
      expect(await page.locator("#member-tx-table tbody tr").count()).toBeGreaterThan(0);
    }

    // Member loot shares the standard pagination: pager visible only when >10 awards.
    const m = /page 1 of (\d+)/.exec((await page.locator("#member-loot-status").textContent()) || "");
    if (m && Number(m[1]) > 1) {
      await expect(page.locator("#member-loot-pager")).toBeVisible();
      await page.locator("#member-loot-pager .pager-btn").last().click(); // "next"
      await expect(page.locator("#member-loot-status")).toContainText(/\(page 2 of/);
    } else {
      await expect(page.locator("#member-loot-pager")).toBeHidden();
    }

    await page.click("#member-back");
    await expect(page.locator("#roster.view.active")).toBeVisible();

    // From Overview, back should return there instead.
    await goTo("overview");
    const ovLink = page.locator("#overview .member-link").first();
    if (await ovLink.count()) {
      await ovLink.click();
      await expect(page.locator("#member.view.active")).toBeVisible();
      await page.click("#member-back");
      await expect(page.locator("#overview.view.active")).toBeVisible();
    }
  });

  test("raid drill-down opens detail and back returns to origin", async () => {
    // Entry point: overview Recent Raids.
    await goTo("overview");
    const link = page.locator("#recent-raids-table tbody tr:first-child .raid-link");
    const raidName = (await link.textContent()).trim();

    await link.click();
    await expect(page.locator("#raid.view.active")).toBeVisible();
    await expect(page.locator("#raid-name")).toHaveText(raidName);
    for (const id of ["raid-attendees", "raid-items", "raid-dkp-spent"]) {
      await expect(page.locator(`#${id}`)).toHaveText(/^(?:[\d,]+|–)$/);
    }
    // Loot rows on the first page match the item count (capped at one page of 10).
    const items = Number((await page.locator("#raid-items").textContent()).replace(/[\s,]/g, ""));
    if (items > 0) {
      await expect(page.locator("#raid-loot-table")).toBeVisible();
      await expect(page.locator("#raid-loot-table tbody tr")).toHaveCount(Math.min(items, 10));
    } else {
      await expect(page.locator("#raid-loot-status")).toContainText(/No loot awarded/);
    }

    // Back returns to the entry point (overview).
    await page.click("#raid-back");
    await expect(page.locator("#overview.view.active")).toBeVisible();

    // From Raid History, back should return there instead.
    await goTo("raids");
    const link2 = page.locator("#raids-table tbody tr:first-child .raid-link");
    await link2.click();
    await expect(page.locator("#raid.view.active")).toBeVisible();
    await page.click("#raid-back");
    await expect(page.locator("#raids.view.active")).toBeVisible();
  });

  test("item links point at pqdi.cc", async () => {
    await goTo("loot");
    const firstLink = page.locator("#loot-table tbody a[href^='https://www.pqdi.cc/item/']").first();
    await expect(firstLink).toBeVisible();
    expect(await firstLink.getAttribute("href")).toMatch(/^https:\/\/www\.pqdi\.cc\/item\/\d+$/);
  });

  test("raid activity heatmap covers the past year", async () => {
    await goTo("overview");
    // Exactly 364 day-cells (7 × 52); hidden padding cells align columns to Sundays.
    await expect(page.locator("#raid-heatmap .hm-cell:not(.hm-empty)")).toHaveCount(364);
    // Both datasets have raids inside the window, so at least one cell is lit.
    await expect(
      page.locator("#raid-heatmap .hm-l1, #raid-heatmap .hm-l2, #raid-heatmap .hm-l3")
    ).not.toHaveCount(0);
    // Summary chips (right of the title) carry the totals: raids / active days / busiest day.
    await expect(page.locator("#heatmap-summary")).toHaveText(/active days/);
    await expect(page.locator("#heatmap-summary .hm-chip")).not.toHaveCount(0);
  });

  test("command palette opens, searches, and navigates", async () => {
    await goTo("overview");
    // Ctrl+K opens with focus on the input; no query shows view quick-jumps.
    await page.keyboard.press("Control+k");
    const input = page.locator("#palette-input");
    await expect(page.locator("#palette")).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator("#palette-results .pal-row", { hasText: "Loot History" })).toHaveCount(1);

    // Search a member (name taken from the standings table — dataset-agnostic).
    const memberName = (await page.locator("#standings-table tbody tr:first-child td:nth-child(2)").textContent()).trim();
    await input.fill(memberName);
    await expect(page.locator("#palette-results .pal-row", { hasText: memberName }).first()).toBeVisible();

    // Enter on the selected row opens the profile; back returns to the origin view.
    await page.keyboard.press("Enter");
    await expect(page.locator("#member.view.active")).toBeVisible();
    await expect(page.locator("#member-name")).toHaveText(memberName);
    await expect(page.locator("#palette")).toBeHidden();
    await page.click("#member-back");
    await expect(page.locator("#overview.view.active")).toBeVisible();

    // View quick-jump navigates and activates the matching nav item.
    await page.keyboard.press("Control+k");
    await page.locator("#palette-results .pal-row", { hasText: "Raid History" }).click();
    await expect(page.locator("#raids.view.active")).toBeVisible();

    // Escape closes without navigating; the topbar button reopens.
    await page.keyboard.press("Control+k");
    await expect(page.locator("#palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#palette")).toBeHidden();
    await expect(page.locator("#raids.view.active")).toBeVisible();

    await page.click("#palette-open");
    await expect(page.locator("#palette")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("browser back/forward navigate natively between views and drill-downs", async () => {
    await goTo("standings");
    const name = (await page.locator("#standings-table tbody tr:first-child td:nth-child(2)").textContent()).trim();
    await page.click("#standings-table tbody tr:first-child .member-link");
    await expect(page.locator("#member.view.active")).toBeVisible();

    // Native browser back returns to the previous view (no in-app button involved).
    await page.goBack();
    await expect(page.locator("#standings.view.active")).toBeVisible();

    // Forward re-enters the drill-down with its state intact.
    await page.goForward();
    await expect(page.locator("#member.view.active")).toBeVisible();
    await expect(page.locator("#member-name")).toHaveText(name);
  });

  test("view transitions slide in from the correct side", async () => {
    await page.goto("/#/overview");
    await expect(page.locator("#overview.view.active")).toBeVisible();
    // In-app nav click = forward push (slides in from the right).
    await page.click('.nav-link[data-target="standings"]');
    await expect(page.locator("#standings")).toHaveAttribute("data-dir", "fwd");
    // Native browser back = pop (slides in from the left).
    await page.goBack();
    await expect(page.locator("#overview")).toHaveAttribute("data-dir", "back");
  });

  test("deep link restores member detail after a full reload", async () => {
    await goTo("standings");
    const name = (await page.locator("#standings-table tbody tr:first-child td:nth-child(2)").textContent()).trim();

    // Navigate to the deep URL, then fully reload: init() must parse the hash and open that member.
    await page.evaluate((n) => { location.hash = "#/member/" + encodeURIComponent(n); }, name);
    await expect(page.locator("#member.view.active")).toBeVisible();
    await page.reload({ waitUntil: "load" });
    // init() renders every view once the loads resolve; standings rows are the completion signal.
    await expect(page.locator("#standings-table tbody tr")).not.toHaveCount(0);
    await expect(page).toHaveURL(new RegExp("#/member/" + encodeURIComponent(name) + "$"));
    await expect(page.locator("#member.view.active")).toBeVisible();
    await expect(page.locator("#member-name")).toHaveText(name);

    // ← Back with an in-app history entry returns to the previous view.
    await page.click("#member-back");
    await expect(page.locator("#standings.view.active")).toBeVisible();
  });
});
// ---------------------------------------------------------------------------
// Mobile bottom nav regression: the bar must stay pinned to the viewport's
// bottom edge after data loads and content expands. It used to be
// `position: fixed`, which iOS/Android leave behind when the dynamic layout
// viewport resizes as content grows; it is now an in-flow sticky element
// (see css/views/app-views.css).
// ---------------------------------------------------------------------------
test("mobile bottom nav stays pinned while scrolling", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 14"] });
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#standings-table tbody tr").length > 0);

  // No horizontal page overflow on phones (fixed-width children must scroll inside their panels).
  const vp = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "no horizontal overflow").toBeLessThanOrEqual(vp.width);

  const check = () =>
    page.evaluate(() => {
      const r = document.querySelector(".sidebar").getBoundingClientRect();
      const el = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.bottom - 10)
      );
      return {
        pinned: Math.abs(r.bottom - innerHeight) <= 2,
        hitNav: !!el && !!el.closest(".sidebar"),
      };
    });

  expect(await check(), "bar pinned at top of page").toEqual({ pinned: true, hitNav: true });

  await page.evaluate(() => window.scrollTo(0, 1500));
  await new Promise((r) => setTimeout(r, 250));
  expect(await check(), "bar pinned mid-page after cards expanded").toEqual({ pinned: true, hitNav: true });

  await ctx.close();
});

// ---------------------------------------------------------------------------
// Offline PWA: the service worker (sw.js) precaches the app shell and serves
// same-origin data files network-first with the cached copy as the offline
// fallback. Every response is tagged X-Data-Freshness — the footer shows
// "· fresh" / "· cached (offline)" and an amber banner appears while the data
// came from cache, so officers always know which state they're viewing.
// The first load registers/claims the worker; the second online load
// populates every cache entry (the first load's subresources fire before the
// worker controls the page). From then on, a fully offline reload must still
// boot the app — and say so.
// ---------------------------------------------------------------------------
test("service worker enables an offline reload", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const rowsReady = () => expect(page.locator("#standings-table tbody tr")).not.toHaveCount(0, { timeout: 20000 });

  // Load 1 (online): app boots; SW registers on window load.
  await page.goto("/index.html");
  await rowsReady();
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg && !!reg.active;
    });
  }, { timeout: 15000 }).toBeTruthy();

  // Load 2 (online): worker controls the page, so every subresource request
  // (data JSON/CSV + cross-origin PapaParse) is intercepted and cached.
  await page.reload({ waitUntil: "load" });
  await rowsReady();

  // Offline reload: navigation falls back to the cached shell; data comes from cache.
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await rowsReady();
  // Retrying assertion: a raw textContent read can catch the count-up animation (or the
  // navigation swap) mid-frame; retry until a settled value matches.
  await expect(page.locator("#stat-total-dkp"), "total DKP should render from cached data offline")
    .toHaveText(/^(?:[\d,]+|–)$/, { timeout: 15000 });

  // Freshness state must be visible while offline: banner + footer say cached.
  await expect(page.locator("#stale-banner"), "offline load shows the stale-data banner").toBeVisible();
  await expect(page.locator("#data-asof")).toContainText("cached (offline)");

  // Back online: network-first serves the current export — fresh, banner gone.
  await ctx.setOffline(false);
  await page.reload({ waitUntil: "load" });
  await rowsReady();
  await expect(page.locator("#stale-banner"), "online load hides the stale-data banner").toBeHidden();
  await expect(page.locator("#data-asof")).toContainText("fresh");

  await ctx.close();
});
