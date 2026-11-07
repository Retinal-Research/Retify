// End-to-end test of the review page in a headless Chromium browser (Chrome or Edge), through the DevTools protocol.
//   node tests/e2e.mjs <page url> <output folder> [width height] [shot-only]
// e.g. with tests/serve.py running: node tests/e2e.mjs "http://127.0.0.1:8811/?data=/data/" /tmp/retify-e2e
// It answers cases, writes a note, reloads (answers must survive), jumps by file name, downloads the answers
// as xlsx/csv/json, clears the browser storage and loads the xlsx back. Screenshots go to the output folder.
// The browser: $CHROME, else the usual install paths. Exits non-zero on a failed check or a page error.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [url, out, w = "1600", h = "1000", mode] = process.argv.slice(2);
if (!url || !out) { console.error("usage: node tests/e2e.mjs <url> <output folder> [width height] [shot-only]"); process.exit(2); }
const outdir = resolve(out);
mkdirSync(outdir, { recursive: true });
const browser = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!browser) { console.error("no Chrome/Edge/Chromium found; set CHROME"); process.exit(2); }

const PORT = 9338;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "retify-e2e-"));
const proc = spawn(browser, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${w},${h}`, "about:blank"], { stdio: "ignore" });
let ws, seq = 0, failed = 0;
const pend = new Map(), errs = [];
const cdp = (m, p = {}) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (n) => writeFileSync(join(outdir, n), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
const key = async (k, code) => {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text: k.length === 1 ? k : undefined });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
  await sleep(400);
};
const check = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (got !== undefined ? "  (" + got + ")" : "")); if (!ok) failed++; };

for (let i = 0; i < 75; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/list`)).ok) break; } catch (e) {} await sleep(200); }
const pg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
ws = new WebSocket(pg.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result || {}); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outdir });
await cdp("Page.navigate", { url }); await sleep(3000);
check("a first visit shows the welcome", await js(`!$("welcome").hidden`));
await js(`$("welcomeok").click()`); await sleep(300);

const n = await js(`files.length`);
check("cases listed", n > 0, n);
check("first image loaded", (await js(`$("img").naturalWidth`)) > 0);
await shot("1_open.png");
if (mode !== "shot-only" && n >= 3) {
  const first3 = await js(`JSON.stringify(files.slice(0,3))`);
  await key("y", "KeyY"); await key("n", "KeyN");
  await js(`$("note").value="e2e note";$("note").dispatchEvent(new Event("input"))`); await sleep(900);
  await key("ArrowLeft", "ArrowLeft");
  check("back to case 2, answered No", (await js(`$("state").textContent`)) === "Answered: No (hallucination)");
  await cdp("Page.reload"); await sleep(2500);
  check("answers survive a reload", (await js(`$("pdone").textContent`)).startsWith("2 /"));
  check("note survives a reload", (await js(`lab[files[2]].note`)) === "e2e note");
  const target = await js(`files[Math.min(files.length-1, 7)].replace(/\\.[^.]+$/,"")`);
  await js(`$("go").value=${JSON.stringify(target.split("_")[0])};$("go").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"}))`); await sleep(500);
  check("go to by file name", (await js(`$("fname").textContent`)).startsWith(target.split("_")[0] + "_"), await js(`$("fname").textContent`));
  await key("n", "KeyN");
  await js(`$("dl").click()`); await sleep(300); await shot("2_download.png");
  await js(`$("dlxlsx").click()`); await sleep(800); await js(`$("dljson").click()`); await sleep(800); await js(`$("dlcsv").click()`); await sleep(1200);
  const files = readdirSync(outdir).filter((f) => f.startsWith("retify_labels_"));
  check("xlsx, csv and json downloaded", ["xlsx", "csv", "json"].every((e) => files.some((f) => f.endsWith("." + e))), files.join(" "));
  const rt = await js(`(async()=>{const b=XLSX_MINI.write([HEAD,...rows()],[6,26,44,40,21]);return JSON.stringify(fromRows(await XLSX_MINI.read(await b.arrayBuffer())))})()`);
  check("xlsx round trip keeps the 3 answers", Object.keys(JSON.parse(rt)).length === 3, rt.length + " chars");
  await js(`localStorage.clear()`); await cdp("Page.reload"); await sleep(2500);
  check("storage cleared", (await js(`$("pdone").textContent`)).startsWith("0 /"));
  const doc = await cdp("DOM.getDocument");
  const nd = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#loadfile" });
  await js(`window.alert=m=>{window._al=m}`);
  await cdp("DOM.setFileInputFiles", { nodeId: nd.nodeId, files: [join(outdir, files.find((f) => f.endsWith(".xlsx")))] }); await sleep(1500);
  check("xlsx loads back", (await js(`$("pdone").textContent`)).startsWith("3 /"), await js(`window._al`));
  check("first two answers restored", (await js(`JSON.stringify(${first3}.slice(0,2).map(f=>lab[f]&&lab[f].hallucination))`)) === "[0,1]");
  await shot("3_loaded.png");
}
check("no page errors", errs.length === 0, errs.join(" | "));
ws.close(); proc.kill(); await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(failed ? 1 : 0);
