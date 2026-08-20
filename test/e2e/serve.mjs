/**
 * Static server for E2E tests.
 *
 * Builds a temp directory containing the app (index.html, css/, js/, style.css,
 * items.json) plus data files — the real exports when present locally, else the
 * known-good sample dataset — and serves it on port 4173.
 */
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = path.join(ROOT, "test/fixtures/sample-data");
const DATA_FILES = ["loot.json", "raids.json", "users.json", "roster-export.csv"];
const hasRealData = DATA_FILES.every((f) => fs.existsSync(path.join(ROOT, f)));
const dataDir = hasRealData ? ROOT : SAMPLE;

/* Build the served directory. */
const www = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-dkp2-e2e-"));
for (const f of ["index.html", "style.css", "items.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(www, f));
}
fs.cpSync(path.join(ROOT, "css"), path.join(www, "css"), { recursive: true });
fs.cpSync(path.join(ROOT, "js"), path.join(www, "js"), { recursive: true });
for (const f of DATA_FILES) fs.copyFileSync(path.join(dataDir, f), path.join(www, f));

console.log(`[e2e] serving ${www} (data from ${path.relative(ROOT, dataDir) || "."})`);

/* Minimal static file server. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/") return serveFile("/index.html");
  function serveFile(p) {
    const file = path.join(www, p);
    if (!file.startsWith(www) || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }
  serveFile(urlPath);
});

server.listen(4173, "127.0.0.1", () => console.log("[e2e] ready on http://127.0.0.1:4173"));
