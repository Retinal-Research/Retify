// Retify hallucination review, a static page: the images come from a data folder (manifest.json + images),
// the answers stay in this browser (localStorage) and leave it only as a file the reviewer downloads.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DATA = (params.get("data") || window.RETIFY_DATA_URL || "").replace(/\/?$/, "/");
let set = null, files = [], lab = {}, i = 0, filt = "all";

const st = (f) => (lab[f] && lab[f].hallucination != null ? (lab[f].hallucination ? "n" : "y") : "p");
const imgUrl = (f) => DATA + set.dir + encodeURIComponent(f);
const key = () => "retify.labels." + set.id;

function nextTodo(from) {
  for (let k = from; k < files.length; k++) if (st(files[k]) === "p") return k;
  for (let k = 0; k < from; k++) if (st(files[k]) === "p") return k;
  return -1;
}
function save(t, err) { const s = $("save"); s.textContent = t; s.classList.toggle("err", !!err); }
function store() {
  try {
    localStorage.setItem(key(), JSON.stringify({ set: set.id, labels: lab }));
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
  $("yes").classList.toggle("sel", s === "y"); $("no").classList.toggle("sel", s === "n");
  $("note").value = (lab[f] && lab[f].note) || "";
  $("prev").disabled = i === 0; $("next").disabled = i === files.length - 1;
  if (files[i + 1]) new Image().src = imgUrl(files[i + 1]);
  stats(); list();
}
function finished() { list(); $("caseview").hidden = true; $("doneview").hidden = false; }
function go(k) { if (k < 0 || k >= files.length) return; i = k; show(); }
function answer(v) {
  const f = files[i];
  lab[f] = { hallucination: v, note: $("note").value.slice(0, 500), time: new Date().toISOString().slice(0, 19) };
  store();
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
    for (const [f, r] of Object.entries(got)) {
      if (!known.has(f) || ![0, 1, null].includes(r.hallucination)) { skip++; continue; }
      if (!lab[f] || lab[f].hallucination == null || (r.time || "") >= (lab[f].time || "")) { lab[f] = r; n++; }
    }
    store();
    alert("Loaded " + n + " answers from " + file.name + (skip ? " (" + skip + " rows were not cases of this set)." : "."));
    const k = nextTodo(0);
    if (k < 0) finished(); else go(k);
  } catch (e) {
    alert("Could not load " + file.name + ": " + e.message);
  }
}

// ---------- wiring ----------
$("yes").onclick = () => answer(0);
$("no").onclick = () => answer(1);
$("prev").onclick = () => go(i - 1);
$("next").onclick = () => go(i + 1);
$("nextp").onclick = () => { const k = nextTodo(i + 1); if (k >= 0) go(k); };
let nt;
$("note").oninput = () => {
  clearTimeout(nt);
  nt = setTimeout(() => { const f = files[i]; lab[f] = { hallucination: null, ...(lab[f] || {}), note: $("note").value.slice(0, 500) }; store(); }, 500);
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
$("img").onclick = () => { $("vimg").src = $("img").src; $("viewer").hidden = false; };
$("viewer").onclick = () => ($("viewer").hidden = true);
$("help").onclick = () => ($("helpbox").hidden = false);
$("helpok").onclick = () => ($("helpbox").hidden = true);
$("dl").onclick = $("dl2").onclick = openDl;
$("dlxlsx").onclick = dl.xlsx; $("dlcsv").onclick = dl.csv; $("dljson").onclick = dl.json;
$("dlclose").onclick = () => ($("dlbox").hidden = true);
$("loadbtn").onclick = () => $("loadfile").click();
$("loadfile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) load(f); };
document.onkeydown = (e) => {
  if (!$("viewer").hidden) { $("viewer").hidden = true; return; }
  if (e.target.tagName === "INPUT" || !$("helpbox").hidden || !$("dlbox").hidden || !set) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ($("caseview").hidden && k !== "arrowleft" && k !== "arrowright") return;
  if (k === "y") answer(0);
  else if (k === "n") answer(1);
  else if (k === "arrowleft") go(i - 1);
  else if (k === "arrowright") go(i + 1);
  else if (k === "enter") $("img").click();
};

function fail(msg) {
  $("caseview").hidden = true; $("errview").hidden = false; $("errmsg").textContent = msg;
  $("setname").textContent = "No images"; ["dl", "loadbtn"].forEach((b) => ($(b).disabled = true));
}
$("img").onerror = () => save("This image did not load — check the connection, then click Next and Previous", true);
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
  restore();
  const k = nextTodo(0);
  i = k < 0 ? 0 : k;
  show();
  if (k < 0) finished();
})();
