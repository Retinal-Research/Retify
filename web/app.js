// Retify hallucination review, a static page: the images come from a data folder (manifest.json + images).
// Every answer is kept in this browser (localStorage). With a relay (RETIFY_LABELS_URL, the lab's server) the
// reviewer also gives a name, and the answers are sent to the lab as they are made, so they can continue on
// any computer and everyone sees everyone's progress (never their answers). Without one, answers leave the
// browser only as a file the reviewer downloads.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DATA = (params.get("data") || window.RETIFY_DATA_URL || "").replace(/\/?$/, "/");
const RELAY = (params.get("relay") || window.RETIFY_LABELS_URL || "").replace(/\/+$/, "");
let set = null, files = [], lab = {}, i = 0, filt = "all";
let me = null;          // the reviewer's session on the relay: {id, name, key}

const st = (f) => (lab[f] && lab[f].hallucination != null ? (lab[f].hallucination ? "n" : "y") : "p");
const imgUrl = (f) => DATA + set.dir + encodeURIComponent(f);
const key = () => "retify.labels." + set.id + (me ? "." + me.id : "");

function nextTodo(from) {
  for (let k = from; k < files.length; k++) if (st(files[k]) === "p") return k;
  for (let k = 0; k < from; k++) if (st(files[k]) === "p") return k;
  return -1;
}
function save(t, err) { const s = $("save"); s.textContent = t; s.classList.toggle("err", !!err); }
function store(changed) {
  try {
    localStorage.setItem(key(), JSON.stringify({ set: set.id, labels: lab }));
    if (me) { queue(changed || []); return true; }
    save("Saved in this browser · " + new Date().toLocaleTimeString());
    return true;
  } catch (e) {
    save("Not saved — download your answers before closing", true);
    return false;
  }
}
function restore() {
  try { lab = JSON.parse(localStorage.getItem(key()) || "{}").labels || {}; } catch (e) { lab = {}; }
}

function stats() {
  const n = files.length, y = files.filter((f) => st(f) === "y").length, no = files.filter((f) => st(f) === "n").length;
  $("ntotal").textContent = n; $("pdone").textContent = y + no + " / " + n;
  $("pyes").textContent = y; $("pno").textContent = no; $("pleft").textContent = n - y - no;
  $("pbar").style.width = (n ? (100 * (y + no)) / n : 0) + "%";
  return n - y - no;
}
function list() {
  const L = $("list"); L.innerHTML = "";
  files.forEach((f, k) => {
    const s = st(f);
    if (filt !== "all" && s !== filt) return;
    const b = document.createElement("button");
    b.className = "c " + (s === "p" ? "" : s) + (k === i ? " cur" : "");
    b.textContent = k + 1; b.title = f; b.onclick = () => go(k);
    L.appendChild(b);
  });
  const cur = L.querySelector(".cur");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}
function show() {
  const f = files[i];
  $("doneview").hidden = true; $("caseview").hidden = false;
  $("title").textContent = "Case " + (i + 1) + " / " + files.length;
  $("fname").textContent = f.replace(/\.[^.]+$/, "");
  const s = st(f);
  $("state").className = "state " + s;
  $("state").textContent = s === "y" ? "Answered: Yes (passes)" : s === "n" ? "Answered: No (hallucination)" : "To do";
  $("img").src = imgUrl(f);
  resetView();
  $("yes").classList.toggle("sel", s === "y"); $("no").classList.toggle("sel", s === "n");
  $("note").value = (lab[f] && lab[f].note) || "";
  $("prev").disabled = i === 0; $("next").disabled = i === files.length - 1;
  if (files[i + 1]) new Image().src = imgUrl(files[i + 1]);
  stats(); list();
}
function finished() {
  list(); $("caseview").hidden = true; $("doneview").hidden = false;
  $("donemsg").innerHTML = me ? "Your answers are saved. Downloading a copy is optional."
    : "Please <b>download your answers</b> and send the file back to us.";
}
function go(k) { if (k < 0 || k >= files.length) return; i = k; show(); }
function answer(v) {
  const f = files[i];
  lab[f] = { hallucination: v, note: $("note").value.slice(0, 500), time: new Date().toISOString().slice(0, 19) };
  store([f]);
  if (!stats()) return finished();
  const k = nextTodo(i + 1);
  go(k < 0 ? i : k);
}

// ---------- download / load answers ----------
const HEAD = ["no", "image", "hallucination (1 = hallucination / N, 0 = passes / Y)", "note", "answered_at"];
function rows() {
  return files.map((f, k) => { const r = lab[f] || {}; return [k + 1, f, r.hallucination ?? "", r.note || "", r.time || ""]; });
}
function fname(ext) { return `retify_labels_${set.id}_${new Date().toISOString().slice(0, 10)}.${ext}`; }
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const dl = {
  xlsx: () => download(XLSX_MINI.write([HEAD, ...rows()], [6, 26, 44, 40, 21], "labels"), fname("xlsx")),
  csv: () => download(new Blob(["﻿" + [HEAD, ...rows()].map((r) => r.map((v) => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(",")).join("\r\n")],
    { type: "text/csv" }), fname("csv")),
  json: () => download(new Blob([JSON.stringify({ set: set.id, data: DATA, exported_at: new Date().toISOString(), labels: lab }, null, 1)],
    { type: "application/json" }), fname("json")),
};
function openDl() {
  const left = stats(), n = files.length;
  $("dlsum").textContent = (n - left) + " of " + n + " cases answered" + (left ? " (" + left + " still to do; you can download now and again later)." : ". Thank you!") +
    " Please send us the Excel file.";
  $("dlbox").hidden = false;
}

function csvRows(text) {
  const out = []; let row = [], cur = "", q = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (q) { if (c === '"') { if (text[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[k + 1] === "\n") k++; row.push(cur); out.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
function fromRows(r) {             // spreadsheet rows -> labels; columns found by their header
  const h = r[0].map((x) => String(x).toLowerCase().replace(/^﻿/, ""));
  const ci = h.findIndex((x) => x === "image"), hi = h.findIndex((x) => x.startsWith("hallucination"));
  const ni = h.findIndex((x) => x === "note"), ti = h.findIndex((x) => x.startsWith("answered"));
  if (ci < 0 || hi < 0) throw new Error('the file has no "image" and "hallucination" columns');
  const out = {};
  for (const row of r.slice(1)) {
    const f = String(row[ci] || "").trim(), v = String(row[hi] ?? "").trim();
    if (!f || (v !== "0" && v !== "1")) continue;
    out[f] = { hallucination: +v, note: ni >= 0 ? String(row[ni] || "") : "", time: ti >= 0 ? String(row[ti] || "") : "" };
  }
  return out;
}
async function load(file) {
  try {
    let got;
    if (/\.json$/i.test(file.name)) {
      const j = JSON.parse(await file.text());
      if (j.set && j.set !== set.id) throw new Error("these answers are for another image set (" + j.set + ")");
      got = j.labels || {};
    } else if (/\.xlsx$/i.test(file.name)) got = fromRows(await XLSX_MINI.read(await file.arrayBuffer()));
    else got = fromRows(csvRows(await file.text()));
    const known = new Set(files);
    let n = 0, skip = 0;
    const took = [];
    for (const [f, r] of Object.entries(got)) {
      if (!known.has(f) || ![0, 1, null].includes(r.hallucination)) { skip++; continue; }
      if (!lab[f] || lab[f].hallucination == null || (r.time || "") >= (lab[f].time || "")) { lab[f] = r; n++; took.push(f); }
    }
    store(took);
    alert("Loaded " + n + " answers from " + file.name + (skip ? " (" + skip + " rows were not cases of this set)." : "."));
    const k = nextTodo(0);
    if (k < 0) finished(); else go(k);
  } catch (e) {
    alert("Could not load " + file.name + ": " + e.message);
  }
}

// ---------- the lab's relay: sessions by name, answers sent as they are made, everyone's progress ----------
async function api(method, path, body) {
  const r = await fetch(RELAY + path, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(me ? { "X-Retify-Key": me.key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "HTTP " + r.status); e.status = r.status; throw e; }
  return j;
}
const outboxKey = () => "retify.outbox." + set.id + "." + me.id;
function outbox() { try { return JSON.parse(localStorage.getItem(outboxKey()) || "[]"); } catch (e) { return []; } }
function setOutbox(o) { try { localStorage.setItem(outboxKey(), JSON.stringify(o)); } catch (e) { /* the answers are still in memory */ } }
function queue(names) {
  const o = outbox().filter((a) => !names.includes(a.image));
  for (const f of names) {
    const r = lab[f];
    if (r && r.time) o.push({ image: f, hallucination: r.hallucination ?? null, note: r.note || "", time: r.time });
  }
  setOutbox(o);
  flush();
}
let sending = false, wait = 2000, retry;
async function flush() {
  if (sending || !me) return;
  let o = outbox();
  if (!o.length) { save("Saved · " + new Date().toLocaleTimeString()); return; }
  sending = true; clearTimeout(retry);
  save("Saving…");
  try {
    while (o.length) {
      const batch = o.slice(0, 200);
      await api("POST", "/labels", { set: set.id, session: me.id, answers: batch });
      const sent = new Map(batch.map((a) => [a.image, a.time]));
      o = outbox().filter((a) => sent.get(a.image) !== a.time);   // answers changed meanwhile stay queued
      setOutbox(o);
    }
    wait = 2000;
    save("Saved · " + new Date().toLocaleTimeString());
    team();
  } catch (e) {
    if (e.status === 403) { sending = false; return enter("Please type your name again."); }
    save("Not saved yet (" + o.length + ") — no connection; keep this page open, it will retry", true);
    retry = setTimeout(flush, wait);
    wait = Math.min(wait * 2, 60000);
  }
  sending = false;
}
addEventListener("online", () => flush());

async function team() {
  if (!me) return;
  try {
    const p = await api("GET", "/progress?set=" + encodeURIComponent(set.id));
    const T = $("teamrows"); T.innerHTML = "";
    for (const r of p.reviewers) {
      const d = document.createElement("div");
      d.className = "trow" + (r.id === me.id ? " me" : "");
      const pct = p.cases ? (100 * r.answered) / p.cases : 0;
      d.innerHTML = "<b></b><span></span><div class='pbar'><i></i></div>";
      d.querySelector("b").textContent = r.name;
      d.querySelector("span").textContent = r.answered + " / " + p.cases;
      d.querySelector("i").style.width = pct + "%";
      T.appendChild(d);
    }
    if (!p.reviewers.length) T.textContent = "No answers yet.";
    $("team").hidden = false;
  } catch (e) { /* progress is a nicety; answers are what matters */ }
}
setInterval(() => { if (me && !document.hidden) team(); }, 15000);

function showWho() {
  const w = $("who");
  w.hidden = !me;
  if (!me) return;
  w.textContent = "Reviewer: " + me.name;
  const b = document.createElement("button");
  b.textContent = "Switch"; b.title = "Review under another name";
  b.onclick = () => enter();
  w.appendChild(b);
}
// the answers of this session on the lab's server, merged with this browser's (the later answer wins)
async function join(s) {
  me = s;
  try { localStorage.setItem("retify.session", JSON.stringify(me)); } catch (e) { /* this tab only */ }
  restore();
  showWho();
  $("setname").textContent = set.title + " · answers are saved automatically";
  try {
    const got = (await api("GET", "/labels?set=" + encodeURIComponent(set.id) + "&session=" + me.id)).labels;
    const mine = [];
    for (const f of files) {
      const a = lab[f], b = got[f];
      if (b && (!a || (b.time || "") > (a.time || ""))) lab[f] = b;
      else if (a && a.time && (!b || (a.time || "") > (b.time || ""))) mine.push(f);
    }
    localStorage.setItem(key(), JSON.stringify({ set: set.id, labels: lab }));
    if (mine.length) queue(mine); else flush();
  } catch (e) {
    if (e.status === 403) return enter("Please type your name again.");
    save("No connection — your answers are kept on this computer and saved when the connection is back", true);
  }
  team();
  const k = nextTodo(0);
  i = k < 0 ? 0 : k;
  show();
  if (k < 0) finished();
}
let asked;
function ask(why) {
  $("sessbox").hidden = false;
  $("sessres").innerHTML = "";
  if (why) { const p = document.createElement("p"); p.textContent = why; $("sessres").appendChild(p); }
  $("sessname").value = me ? me.name : "";
  $("sessfind").classList.add("primary");
  $("sessname").focus();
  return new Promise((done) => (asked = done));
}
// the first visit in this browser: a short welcome, before anything else
function welcome() {
  let seen = false;
  try { seen = localStorage.getItem("retify.welcomed") === "1"; } catch (e) { /* show it */ }
  if (seen) return Promise.resolve();
  $("welcome").hidden = false;
  return new Promise((done) => ($("welcomeok").onclick = () => {
    $("welcome").hidden = true;
    try { localStorage.setItem("retify.welcomed", "1"); } catch (e) { /* once per page then */ }
    done();
  }));
}
// ask for the name, then work in that session; without one, in this browser only (as without a relay)
async function enter(why) {
  const s = await ask(why);
  if (s) return join(s);
  if (!me) local();
}
function local() {
  me = null;
  showWho();
  $("setname").textContent = set.title + " · answers stay in this browser until you download them";
  restore();
  const k = nextTodo(0);
  i = k < 0 ? 0 : k;
  show();
  if (k < 0) finished();
}
function closeAsk(s) { $("sessbox").hidden = true; if (asked) { asked(s); asked = null; } }
function choice(label, sub, onclick, primary) {
  const b = document.createElement("button");
  b.className = "sess" + (primary ? " primary" : "");
  b.innerHTML = "<span></span><small></small>";
  b.querySelector("span").textContent = label;
  b.querySelector("small").textContent = sub;
  b.onclick = onclick;
  $("sessres").appendChild(b);
}
async function findSession(e) {
  if (e) e.preventDefault();
  const name = $("sessname").value.trim();
  const R = $("sessres"); R.innerHTML = "";
  $("sessfind").classList.add("primary");
  if (!name) return $("sessname").focus();
  const say = (t) => { const p = document.createElement("p"); p.textContent = t; R.appendChild(p); };
  try {
    const { matches } = await api("POST", "/sessions/find", { name });
    if (matches.length) {
      say("We found these sessions for “" + name + "”. Is one of them yours?");
      for (const m of matches) {
        choice(m.name, m.answered + " answered", async () => { try { closeAsk(await api("POST", "/sessions/enter", { id: m.id })); } catch (x) { say("That did not work. Please try again."); } }, true);
      }
      choice("None of these is me", "start a new session", () => newSession(name));
    } else {
      newSession(name, "No session was found for “" + name + "”. Would you like to start a new session?");
    }
  } catch (x) {
    say("No connection right now. Please try again, or choose Continue Without Saving and download your answers when you finish.");
  }
}
// a new session needs the full name, so that a reviewer finds it again and is not confused with another
function newSession(typed, why) {
  const R = $("sessres"); R.innerHTML = "";
  $("sessfind").classList.remove("primary");   // one main button at a time: here, Start a new session
  const p = document.createElement("p");
  p.textContent = (why ? why + " " : "") + "Please enter your full name, first and last.";
  const f = document.createElement("form");
  f.innerHTML = "<input class='note' id='fullname' autocomplete='name' placeholder='e.g., Tina Vascullensky' maxlength='80'>" +
    "<div class='row'><button type='submit' class='primary'>Start a new session</button></div>";
  R.append(p, f);
  const input = f.querySelector("input");
  input.value = typed.trim().split(/\s+/).length >= 2 ? typed.trim() : "";
  input.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const full = input.value.trim().replace(/\s+/g, " ");
    if (full.split(/[\s,]+/).filter(Boolean).length < 2) { p.textContent = "Please enter your full name, first and last (e.g., Tina Vascullensky)."; return input.focus(); }
    try { closeAsk(await api("POST", "/sessions", { name: full })); } catch (x) { p.textContent = "That did not work. Please try again."; }
  };
}
$("sessform").onsubmit = findSession;
$("sessfind").onclick = findSession;
$("sesslocal").onclick = () => { $("sessbox").hidden = true; if (asked) { asked(null); asked = null; } };

// ---------- wiring ----------
$("yes").onclick = () => answer(0);
$("no").onclick = () => answer(1);
$("prev").onclick = () => go(i - 1);
$("next").onclick = () => go(i + 1);
$("nextp").onclick = () => { const k = nextTodo(i + 1); if (k >= 0) go(k); };
let nt;
$("note").oninput = () => {
  clearTimeout(nt);
  nt = setTimeout(() => {
    const f = files[i];
    lab[f] = { hallucination: null, ...(lab[f] || {}), note: $("note").value.slice(0, 500), time: new Date().toISOString().slice(0, 19) };
    store([f]);
  }, 500);
};
document.querySelectorAll("#filter button").forEach((b) => (b.onclick = () => {
  filt = b.dataset.f;
  document.querySelectorAll("#filter button").forEach((x) => x.classList.toggle("on", x === b));
  list();
}));
$("go").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  const v = $("go").value.trim();
  if (!v) return;
  // a number is a case number when it is in range; otherwise (EyePACS names are numbers too) part of a file name
  const byName = (s) => { const a = files.findIndex((f) => f.toLowerCase().startsWith(s + "_")); return a >= 0 ? a : files.findIndex((f) => f.toLowerCase().includes(s)); };
  const k = /^\d+$/.test(v) && +v >= 1 && +v <= files.length ? +v - 1 : byName(v.toLowerCase());
  if (k >= 0 && k < files.length) { go(k); $("go").value = ""; $("go").blur(); }
  else { $("go").style.borderColor = "#b8433b"; setTimeout(() => ($("go").style.borderColor = ""), 900); }
};
// ---------- the picture: scroll to zoom at the pointer, drag to move; never smaller than it fits ----------
// view.s is the zoom over the fitted picture (1 = it fits the frame); view.x, view.y its top left corner in the frame
let view = { s: 1, x: 0, y: 0 }, fit = { w: 0, h: 0 };
function applyView() {
  const st = $("stage"), W = st.clientWidth, H = st.clientHeight, im = $("img");
  if (!im.naturalWidth || !W || !H) return;
  const k = Math.min(W / im.naturalWidth, H / im.naturalHeight);
  fit = { w: im.naturalWidth * k, h: im.naturalHeight * k };
  im.style.width = fit.w + "px"; im.style.height = fit.h + "px";
  view.s = Math.min(8, Math.max(1, view.s));
  // along each side: centred while the picture is narrower than the frame, else no empty space at its edges
  const place = (v, size, frame) => (size <= frame ? (frame - size) / 2 : Math.min(0, Math.max(frame - size, v)));
  view.x = place(view.x, fit.w * view.s, W);
  view.y = place(view.y, fit.h * view.s, H);
  im.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`;
  $("resetview").disabled = view.s === 1;
}
function resetView() { view = { s: 1, x: 0, y: 0 }; applyView(); }
$("stage").addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = $("stage").getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const s = Math.min(8, Math.max(1, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));   // ctrlKey: a trackpad pinch
  view.x = px - ((px - view.x) * s) / view.s;
  view.y = py - ((py - view.y) * s) / view.s;
  view.s = s;
  applyView();
}, { passive: false });
let drag = null;
$("stage").onpointerdown = (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX - view.x, y: e.clientY - view.y };
  $("stage").setPointerCapture(e.pointerId);
  $("stage").classList.add("drag");
};
$("stage").onpointermove = (e) => { if (drag) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); } };
$("stage").onpointerup = $("stage").onpointercancel = () => { drag = null; $("stage").classList.remove("drag"); };
$("stage").ondblclick = resetView;
addEventListener("resize", applyView);
$("resetview").onclick = resetView;
const fullSize = () => { $("vimg").src = $("img").src; $("viewer").hidden = false; };
$("fullsize").onclick = fullSize;
$("viewer").onclick = () => ($("viewer").hidden = true);
$("help").onclick = () => {
  if (me) $("helpstore").innerHTML = "Your answers are saved automatically under your name (<b>" + me.name.replace(/[<&]/g, "") +
    "</b>). To continue on another computer, open this page there and type the same name. Others see only how many cases you have answered, never your answers. <b>Download answers</b> gives you a copy.";
  $("helpbox").hidden = false;
};
$("helpok").onclick = () => ($("helpbox").hidden = true);
$("dl").onclick = $("dl2").onclick = openDl;
$("dlxlsx").onclick = dl.xlsx; $("dlcsv").onclick = dl.csv; $("dljson").onclick = dl.json;
$("dlclose").onclick = () => ($("dlbox").hidden = true);
$("loadbtn").onclick = () => $("loadfile").click();
$("loadfile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) load(f); };
document.onkeydown = (e) => {
  if (!$("viewer").hidden) { $("viewer").hidden = true; return; }
  if (e.target.tagName === "INPUT" || !$("helpbox").hidden || !$("dlbox").hidden || !$("sessbox").hidden || !$("welcome").hidden || !set) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ($("caseview").hidden && k !== "arrowleft" && k !== "arrowright") return;
  if (k === "y") answer(0);
  else if (k === "n") answer(1);
  else if (k === "arrowleft") go(i - 1);
  else if (k === "arrowright") go(i + 1);
  else if (k === "enter") fullSize();
  else if (k === "0") resetView();
};

function fail(msg) {
  $("caseview").hidden = true; $("errview").hidden = false; $("errmsg").textContent = msg;
  $("setname").textContent = "No images"; ["dl", "loadbtn"].forEach((b) => ($(b).disabled = true));
}
$("img").onerror = () => save("This image did not load — check the connection, then click Next and Previous", true);
$("img").addEventListener("load", resetView);
$("img").onload = () => { if ($("save").classList.contains("err") && /image/.test($("save").textContent)) save("Saved in this browser"); };

(async () => {
  if (DATA === "/") return fail("This copy of the page has no image folder set (config.js or ?data=).");
  let m;
  try {
    const r = await fetch(DATA + "manifest.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    m = await r.json();
  } catch (e) {
    return fail("The image list could not be loaded from " + DATA + " (" + e.message + "). Check the internet connection and reload the page.");
  }
  const sets = m.sets || [];
  set = sets.find((s) => s.id === params.get("set")) || sets[0];
  if (!set || !set.cases || !set.cases.length) return fail("The image folder lists no cases.");
  set.dir = (set.dir || "").replace(/\/?$/, "/").replace(/^\/$/, "");
  files = set.cases;
  $("setname").textContent = set.title + " · answers stay in this browser until you download them";
  document.title = "Retify · " + set.title;
  if (sets.length > 1) {        // several image sets: a menu at the top of the queue
    const sel = document.createElement("select");
    sel.id = "setsel";
    sel.style.cssText = "width:100%;margin:0 0 10px;padding:7px;border:1px solid #d3dde3;border-radius:8px;background:#fff";
    for (const s of sets) sel.add(new Option(s.title + " (" + s.cases.length + ")", s.id, false, s === set));
    sel.onchange = () => { params.set("set", sel.value); location.search = params.toString(); };
    $("filter").parentElement.insertBefore(sel, $("filter").parentElement.children[2]);
  }
  if (!RELAY) { local(); return welcome(); }
  let s = null;
  try { s = JSON.parse(localStorage.getItem("retify.session") || "null"); } catch (e) { /* ask */ }
  if (s && s.id && s.key) return join(s);
  local();          // the page works behind the question, in this browser, until a session is chosen
  await welcome();
  enter();
})();
