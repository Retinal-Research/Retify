// End-to-end test of the review page with the relay, in headless Chromium through the DevTools protocol.
//   node tests/e2e_relay.mjs <data folder> <output folder>
// It starts tests/serve.py (port 8811) and relay/relay.py (port 8097, answers in <output folder>/answers), then:
// a reviewer creates a session by name and answers; everyone's progress shows the count; a second browser
// finds the session by part of the name and gets the answers back; with the relay stopped answers wait in
// the browser, and they are sent when it is back. The browser: $CHROME, else the usual install paths.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [data, out] = process.argv.slice(2);
if (!data || !out) { console.error("usage: node tests/e2e_relay.mjs <data folder> <output folder>"); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(out);
mkdirSync(outdir, { recursive: true });
const browser = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!browser) { console.error("no Chrome/Edge/Chromium found; set CHROME"); process.exit(2); }
const py = process.platform === "win32" ? "python" : "python3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (got !== undefined ? "  (" + got + ")" : "")); if (!ok) failed++; };

const settings = join(outdir, "relay.json");
rmSync(join(outdir, "answers"), { recursive: true, force: true });
writeFileSync(settings, JSON.stringify({ data_url: "http://127.0.0.1:8811/data/", data_dir: join(outdir, "answers"), port: 8097,
  origins: ["http://127.0.0.1:*"], hf: { repo: "" } }));
const serve = spawn(py, [join(ROOT, "tests", "serve.py"), resolve(data)], { stdio: "ignore" });
let relay;
const startRelay = async () => {
  relay = spawn(py, [join(ROOT, "relay", "relay.py"), settings], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch("http://127.0.0.1:8097/api/retify/status")).ok) return; } catch (e) {} await sleep(200); }
  throw new Error("the relay did not start");
};
await sleep(800);
await startRelay();
const URL = "http://127.0.0.1:8811/?data=/data/&relay=http://127.0.0.1:8097/api/retify";

// one headless browser with its own profile, driven over the DevTools protocol
async function open(port) {
  const profile = mkdtempSync(join(tmpdir(), "retify-relay-"));
  const proc = spawn(browser, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1500,950", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/list`)).ok) break; } catch (e) {} await sleep(200); }
  const pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pend = new Map(), errs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result || {}); pend.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const cdp = (m, p = {}) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: URL }); await sleep(2500);
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await js(expr)) return true; await sleep(250); } return false; };
  const shot = async (n) => writeFileSync(join(outdir, n), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const close = () => { ws.close(); proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 500); };
  return { js, until, shot, close, errs };
}
const find = (b, name) => b.js(`$("sessname").value=${JSON.stringify(name)};$("sessfind").click()`).then(() => b.until(`!!document.querySelector("#sessres .sess, #fullname")`));
const saved = `/^Saved ·/.test($("save").textContent)`;

// 1. a new reviewer creates a session by name and answers two cases
const a = await open(9338);
check("the page first asks who is reviewing (no welcome yet)", await a.js(`!$("sessbox").hidden && $("welcome").hidden`));
await find(a, "Tester");
check("an unknown name offers a new session", /No session was found/.test(await a.js(`$("sessres").textContent`)));
await a.js(`$("fullname").value="Reviewer";$("fullname").form.requestSubmit()`); await new Promise((r) => setTimeout(r, 300));
check("a new session needs the full name", /full name/.test(await a.js(`$("sessres").textContent`)) && !(await a.js(`$("sessbox").hidden`)));
await a.js(`$("fullname").value="Test Reviewer";$("fullname").form.requestSubmit()`);
await a.until(`$("sessbox").hidden`);
check("a new reviewer then gets the welcome", await a.until(`!$("welcome").hidden`));
await a.js(`$("welcomeok").click()`); await sleep(300);
check("the top bar names the reviewer", /Test Reviewer/.test(await a.js(`$("who").textContent`)));
await a.js(`answer(0)`); await a.js(`answer(1)`);
check("the answers reach the lab", await a.until(saved), await a.js(`$("save").textContent`));
check("everyone's progress shows the count with the masked name, marked as this reviewer",
  await a.until(`/Te\\*t Revi\\*\\*\\*r\\s*2 \\/ /.test($("teamrows").innerText) && !!document.querySelector("#teamrows .trow.me")`), await a.js(`$("teamrows").innerText`));
check("and no full names in it", !/Test Reviewer/.test(await a.js(`$("teamrows").innerText`)));
await a.shot("relay_1_reviewing.png");

// 2. another browser finds the session by part of the name; the answers come back
const b = await open(9339);
await find(b, "reviewer");
check("part of the name finds the session", /We found these sessions[\s\S]*Test Reviewer[\s\S]*2 annotated/.test(await b.js(`$("sessres").textContent`)));
await b.js(`document.querySelector("#sessres .sess.primary").click()`);
check("the answers come back in the other browser", await b.until(`$("pdone").textContent.startsWith("2 /")`), await b.js(`$("pdone").textContent`));
check("a reviewer who has answered gets no welcome", await b.js(`$("welcome").hidden`));
b.close();

// 3. with the relay down, answers wait in the browser; when it is back, they are sent
relay.kill(); await sleep(500);
await a.js(`answer(0)`);
check("relay down: the answer waits in the browser", await a.until(`/Not saved yet \\(1\\)/.test($("save").textContent)`), await a.js(`$("save").textContent`));
await startRelay();
check("relay back: the waiting answer is sent", await a.until(saved, 70000), await a.js(`$("save").textContent`));
const sid = await a.js(`me.id`);
const log = readFileSync(join(outdir, "answers", "log", await a.js(`set.id`), `${sid}.jsonl`), "utf8").trim().split("\n");
check("the relay logged all three answers", log.length === 3, log.length);
check("no page errors", a.errs.length === 0, a.errs.join(" | "));
a.close(); relay.kill(); serve.kill(); await sleep(600);
process.exit(failed ? 1 : 0);
