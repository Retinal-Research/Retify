"""Retify hallucination review — double-click, a local review page opens in the browser.

Place the program next to the "images" folder (optional "order.txt" fixes the case order).
Every answer is saved immediately to labels.json and labels.xlsx in the same folder;
reopening continues where the reviewer stopped. Served on 127.0.0.1 only, nothing is uploaded.
"""
import json
import os
import socket
import sys
import threading
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

BASE = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
IMG_DIR = BASE / "images"
JSON = BASE / "labels.json"
XLSX = BASE / "labels.xlsx"
EXT = (".jpg", ".jpeg", ".png")
LOCK = threading.Lock()

PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Retify · Hallucination review</title>
<style>
:root{--ink:#23313b;--muted:#657581;--border:#e0e6ea;--bg:#f4f6f8;--accent:#216f6b;--accent-soft:#edf5f4;
--yes:#23845a;--yes-soft:#edf7f1;--no:#b8433b;--no-soft:#fbefee;--pend:#c98a1a;--shadow:0 2px 8px rgba(27,48,62,.05)}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
button,input{font:inherit;color:inherit}[hidden]{display:none!important}
button{cursor:pointer;border:1px solid #d5dee3;border-radius:8px;background:#fff;padding:8px 13px;font-size:13px;font-weight:550;transition:.15s}
button:hover{background:#f5f8f9;border-color:#b5c4cc}button:disabled{opacity:.4;cursor:default}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input{border:1px solid #d3dde3;border-radius:8px;background:#fff;padding:8px 10px;width:100%}
.eyebrow{font-size:10px;font-weight:650;letter-spacing:1.2px;color:var(--muted);text-transform:uppercase}
kbd{display:inline-block;min-width:22px;padding:1px 6px;border:1px solid #cfd8de;border-bottom-width:2px;border-radius:5px;background:#fff;font:600 11px/1.5 Consolas,monospace;text-align:center;color:#4a5a64}
/* top bar */
.top{display:flex;align-items:center;gap:16px;background:#fff;border-bottom:1px solid var(--border);padding:14px 26px;min-height:76px}
.mark{display:grid;place-items:center;width:42px;height:42px;border:1px solid #d3e4e2;border-radius:12px;background:#f0f7f6}
.mark svg{width:26px;height:26px;fill:none;stroke:var(--accent);stroke-width:1.6}
.top .eyebrow{color:var(--accent)}.top h1{margin:0;font-size:20px;font-weight:650;letter-spacing:-.4px}
.top .sub{font-size:11px;color:var(--muted)}
.top-right{margin-left:auto;display:flex;align-items:center;gap:9px}
#save{font-size:12px;color:var(--muted);margin-right:6px}#save::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#3aa56a;margin-right:7px;vertical-align:1px}
#save.err{color:var(--no)}#save.err::before{background:var(--no)}
.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.primary:hover{background:#364853}
/* layout */
.work{display:grid;grid-template-columns:250px minmax(0,1fr);height:calc(100vh - 76px)}
.side{background:#fbfcfd;border-right:1px solid var(--border);padding:20px 16px;overflow-y:auto}
.side h2{margin:4px 0 12px;font-size:19px}.side h2 span{font-size:13px;font-weight:400;color:#6f808b;margin-left:4px}
.prog{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:12px 0;margin-bottom:14px}
.pbar{height:7px;border-radius:9px;background:#e7edf0;overflow:hidden;margin:6px 0 8px}.pbar i{display:block;height:100%;width:0;background:var(--accent);transition:width .3s}
.pline{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}.pline b{color:var(--ink)}
.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:6px 0 12px}
.seg button{padding:6px 0;font-size:11px}.seg button.on{background:var(--accent-soft);border-color:#78a7a3;color:#175954}
.lbl{font-size:11px;color:var(--muted);font-weight:600;margin:10px 0 5px}
.legend{display:flex;gap:12px;font-size:10px;color:#778791;margin:12px 0 8px}.legend span::before{content:"";display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.lg-p::before{border:2px solid var(--pend)}.lg-y::before{background:var(--yes)}.lg-n::before{background:var(--no)}
#list{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.c{padding:5px 0;font-size:11px;font-variant-numeric:tabular-nums;border-radius:6px;border:1px solid #e6dcc6;background:#fffaf0;color:#8a5a12}
.c.y{background:var(--yes-soft);border-color:#b9dcc7;color:#1f6b45}.c.n{background:var(--no-soft);border-color:#e7c2be;color:#99352e}
.c.cur{outline:2px solid var(--accent);outline-offset:1px;font-weight:700}
main{overflow-y:auto;padding:16px 28px 16px}
.instr{background:#fff;border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:12px;box-shadow:var(--shadow);padding:11px 20px;margin-bottom:12px}
.instr .q{font-size:21px;font-weight:650;letter-spacing:-.3px;margin:1px 0 3px}
.instr .r{font-size:14.5px;color:#3c4c57;line-height:1.55}
.dot{display:inline-block;width:11px;height:11px;border-radius:3px;margin:0 5px 0 2px;vertical-align:-1px}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:10px}.toolbar .navr{margin-left:auto;display:flex;gap:8px}
.toolbar h2{margin:0;font-size:21px;letter-spacing:-.4px}.pill{font-size:11px;color:#49626c;background:#eef2f4;border:1px solid #dce4e8;border-radius:6px;padding:4px 9px;font-family:Consolas,monospace}
.state{font-size:12px;font-weight:650;border-radius:6px;padding:4px 10px}.state.y{background:var(--yes-soft);color:var(--yes)}.state.n{background:var(--no-soft);color:var(--no)}.state.p{background:#fff5e2;color:#9a6714}
.card{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:10px;position:relative}
.card img{display:block;margin:0 auto;max-width:100%;height:max(260px,calc(100vh - 465px));object-fit:contain;border-radius:8px;cursor:zoom-in}
.zoomhint{position:absolute;right:20px;top:18px;font-size:11px;color:#fff;background:rgba(0,0,0,.45);border-radius:6px;padding:3px 8px;pointer-events:none}
.answer{display:flex;flex-direction:column;align-items:center;margin-top:12px}
.big{display:flex;gap:18px}
.big button{width:300px;padding:11px 10px;border-radius:14px;font-size:22px;font-weight:700;border-width:2px}
.big .yes{color:var(--yes);border-color:#a9d3bc;background:#fff}.big .yes:hover,.big .yes.sel{background:var(--yes);color:#fff;border-color:var(--yes)}
.big .no{color:var(--no);border-color:#e3b5b0;background:#fff}.big .no:hover,.big .no.sel{background:var(--no);color:#fff;border-color:var(--no)}
.big small{display:block;font-size:12px;font-weight:500;opacity:.8;margin-top:2px}
.note{width:618px;margin-top:10px;padding:6px 10px;font-size:13px}
.done{text-align:center;padding:60px 20px}.done h2{font-size:26px;margin:0 0 8px}
/* modals */
.modal{position:fixed;inset:0;background:rgba(20,30,38,.55);display:flex;align-items:center;justify-content:center;z-index:10}
.box{background:#fff;border-radius:16px;padding:26px 30px;width:min(520px,92vw);box-shadow:0 20px 50px rgba(0,0,0,.25)}
.box h2{margin:0 0 6px;font-size:22px}.box p{color:var(--muted);margin:0 0 14px}
.box .row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.viewer{position:fixed;inset:0;background:rgba(10,12,14,.94);z-index:20;overflow:auto;cursor:zoom-out}
.viewer img{display:block;margin:20px auto;max-width:none;width:min(1600px,96vw)}
</style></head><body>
<header class="top">
 <div class="mark"><svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/></svg></div>
 <div><div class="eyebrow">Enhancement review</div><h1>Retify · Hallucination review</h1><div class="sub">Local tool · answers save automatically to labels.xlsx and labels.json</div></div>
 <div class="top-right"><span id="save">Saved locally</span>
  <button id="help">How to</button><button class="primary" id="openx">Open results folder</button></div>
</header>
<div class="work">
 <aside class="side">
  <div class="eyebrow">Review queue</div><h2>Cases <span id="ntotal"></span></h2>
  <div class="prog"><div class="pline"><span>Progress</span><b id="pdone"></b></div><div class="pbar"><i id="pbar"></i></div>
   <div class="pline"><span>Pass <b id="pyes"></b></span><span>Halluc. <b id="pno"></b></span><span>Left <b id="pleft"></b></span></div></div>
  <div class="lbl">Show</div>
  <div class="seg" id="filter"><button data-f="all" class="on">All</button><button data-f="p">To do</button><button data-f="y">Pass</button><button data-f="n">Halluc.</button></div>
  <div class="lbl">Go to case number or file name</div><input id="go" placeholder="e.g. 125 or 13026_right">
  <div class="legend"><span class="lg-p">To do</span><span class="lg-y">Pass</span><span class="lg-n">Hallucination</span></div>
  <div id="list"></div>
 </aside>
 <main>
  <div class="instr">
   <div class="eyebrow">The only question</div>
   <div class="q">Is the ENHANCED image free of hallucinations?</div>
   <div class="r">Hallucination = vessels that are <b>invented, missing, displaced or distorted</b> compared with the original. Answer <b>Yes</b> = passes, <b>No</b> = hallucination. Ignore changes of color, brightness and sharpness.<br>
   In the picture: <span class="dot" style="background:#4096ff"></span><b>blue</b> = vessel only after enhancement · <span class="dot" style="background:#ff3c3c"></span><b>red</b> = vessel lost after enhancement · yellow boxes 1–4 are zoomed in panel D. The automatic marks can be wrong; your judgement decides.</div>
  </div>
  <div id="caseview">
   <div class="toolbar"><h2 id="title"></h2><span class="pill" id="fname"></span><span class="state p" id="state"></span>
    <div class="navr"><button id="prev">← Previous</button><button id="next">Next →</button><button id="nextp">Next to do</button></div></div>
   <div class="card"><img id="img" alt="case image" title="Click to enlarge"><span class="zoomhint">Click image to enlarge</span></div>
   <div class="answer">
    <div class="big"><button class="yes" id="yes">Yes — passes<small>press Y</small></button><button class="no" id="no">No — hallucination<small>press N</small></button></div>
    <input class="note" id="note" placeholder="Optional note for this case (saved automatically)">
   </div>
  </div>
  <div class="done" id="doneview" hidden><h2>All cases are answered — thank you!</h2><p>Your answers are in <b>labels.xlsx</b> and <b>labels.json</b> next to this program. Please send labels.xlsx back to us.</p><p>You can still click any case on the left to review or change it.</p></div>
 </main>
</div>
<div class="modal" id="helpbox" hidden><div class="box" style="width:min(640px,92vw)"><h2>How to review</h2>
 <p>For each case, look at the enhanced photograph (B) and compare it with the original (A). Panel C shows where vessels changed; panel D zooms into the yellow boxes: original · enhanced · enhanced with outlines · red-free original.</p>
 <p>Click <b>No</b> if the enhanced image has invented, missing, displaced or distorted vessels; otherwise click <b>Yes</b> (passes). The next unanswered case opens automatically. You can return to any case from the list on the left and change the answer.</p>
 <p>Keys: <kbd>Y</kbd> yes, passes · <kbd>N</kbd> no, hallucination · <kbd>←</kbd> <kbd>→</kbd> previous / next · <kbd>Enter</kbd> enlarge the image.</p>
 <p>Answers are saved after every click. You can close the window at any time and continue later. When finished, send <b>labels.xlsx</b>.</p>
 <div class="row"><button class="primary" id="helpok">Got it</button></div></div></div>
<div class="viewer" id="viewer" hidden><img id="vimg" alt=""></div>
<script>
const $=id=>document.getElementById(id);let files=[],lab={},i=0,filt="all";
const st=f=>lab[f]&&lab[f].hallucination!=null?(lab[f].hallucination?"n":"y"):"p";
function nextTodo(from){for(let k=from;k<files.length;k++)if(st(files[k])==="p")return k;for(let k=0;k<from;k++)if(st(files[k])==="p")return k;return -1}
function save(t,err){const s=$("save");s.textContent=t;s.classList.toggle("err",!!err)}
async function post(url,obj){try{const r=await fetch(url,{method:"POST",body:JSON.stringify(obj)});if(!r.ok)throw 0;
 save("Saved locally · "+new Date().toLocaleTimeString());return true}catch(e){save("Not saved — keep the program window open",true);return false}}
function stats(){const n=files.length,y=files.filter(f=>st(f)==="y").length,no=files.filter(f=>st(f)==="n").length;
 $("ntotal").textContent=n;$("pdone").textContent=(y+no)+" / "+n;$("pyes").textContent=y;$("pno").textContent=no;$("pleft").textContent=n-y-no;
 $("pbar").style.width=(n?100*(y+no)/n:0)+"%";return n-y-no}
function list(){const L=$("list");L.innerHTML="";files.forEach((f,k)=>{const s=st(f);if(filt!=="all"&&s!==filt)return;
 const b=document.createElement("button");b.className="c "+(s==="p"?"":s)+(k===i?" cur":"");b.textContent=k+1;b.title=f;b.onclick=()=>go(k);L.appendChild(b)});
 const cur=L.querySelector(".cur");if(cur)cur.scrollIntoView({block:"nearest"})}
function show(){const f=files[i];$("doneview").hidden=true;$("caseview").hidden=false;
 $("title").textContent="Case "+(i+1)+" / "+files.length;$("fname").textContent=f;const s=st(f);
 $("state").className="state "+s;$("state").textContent=s==="y"?"Answered: Yes (passes)":s==="n"?"Answered: No (hallucination)":"To do";
 $("img").src="/img/"+encodeURIComponent(f);$("yes").classList.toggle("sel",s==="y");$("no").classList.toggle("sel",s==="n");
 $("note").value=(lab[f]&&lab[f].note)||"";$("prev").disabled=i===0;$("next").disabled=i===files.length-1;
 if(files[i+1])new Image().src="/img/"+encodeURIComponent(files[i+1]);stats();list()}
function go(k){if(k<0||k>=files.length)return;i=k;show()}
async function answer(v){const f=files[i];const prev=lab[f];lab[f]={...(lab[f]||{}),hallucination:v,note:$("note").value};
 if(!await post("/label",{image:f,hallucination:v,note:$("note").value})){lab[f]=prev;return}
 const left=stats();if(!left){list();$("caseview").hidden=true;$("doneview").hidden=false;return}
 const k=nextTodo(i+1);go(k<0?i:k)}
$("yes").onclick=()=>answer(0);$("no").onclick=()=>answer(1);
$("prev").onclick=()=>go(i-1);$("next").onclick=()=>go(i+1);$("nextp").onclick=()=>{const k=nextTodo(i+1);if(k>=0)go(k)};
let nt;$("note").oninput=()=>{clearTimeout(nt);nt=setTimeout(()=>{const f=files[i];lab[f]={...(lab[f]||{hallucination:null}),note:$("note").value};
 post("/label",{image:f,hallucination:lab[f].hallucination??null,note:$("note").value})},600)};
document.querySelectorAll("#filter button").forEach(b=>b.onclick=()=>{filt=b.dataset.f;document.querySelectorAll("#filter button").forEach(x=>x.classList.toggle("on",x===b));list()});
$("go").onkeydown=e=>{if(e.key!=="Enter")return;const v=$("go").value.trim();if(!v)return;
 let k=/^\d+$/.test(v)?parseInt(v)-1:files.findIndex(f=>f.toLowerCase().includes(v.toLowerCase()));
 if(k>=0&&k<files.length){go(k);$("go").value="";$("go").blur()}else{$("go").style.borderColor="#b8433b";setTimeout(()=>$("go").style.borderColor="",900)}};
$("img").onclick=()=>{$("vimg").src=$("img").src;$("viewer").hidden=false};$("viewer").onclick=()=>$("viewer").hidden=true;
$("help").onclick=()=>$("helpbox").hidden=false;$("helpok").onclick=()=>$("helpbox").hidden=true;
$("openx").onclick=()=>fetch("/open");
document.onkeydown=e=>{if(!$("viewer").hidden){$("viewer").hidden=true;return}
 if(e.target.tagName==="INPUT"||!$("helpbox").hidden)return;const k=e.key.toLowerCase();
 if(k==="y")answer(0);else if(k==="n")answer(1);else if(k==="arrowleft")go(i-1);else if(k==="arrowright")go(i+1);
 else if(k==="enter")$("img").click()};
fetch("/state").then(r=>r.json()).then(s=>{files=s.files;lab=s.labels;
 if(!files.length){$("caseview").innerHTML="<p>No images found in the images folder.</p>";return}
 const k=nextTodo(0);i=k<0?0:k;show();if(k<0){$("caseview").hidden=true;$("doneview").hidden=false}});
</script></body></html>"""


def list_images():
    """Case order: order.txt (one file name per line, shuffled so photos of one person are apart), else by name."""
    have = {f for f in os.listdir(IMG_DIR) if f.lower().endswith(EXT)}
    order = BASE / "order.txt"
    if order.exists():
        listed = [l.strip() for l in order.read_text(encoding="utf-8").splitlines() if l.strip() in have]
        return listed + sorted(have - set(listed))
    return sorted(have)


def load() -> dict:
    if JSON.exists():
        try:
            d = json.loads(JSON.read_text(encoding="utf-8"))
            if "labels" in d:
                return d
        except Exception:  # noqa: BLE001
            JSON.replace(BASE / f"labels_broken_{datetime.now():%Y%m%d_%H%M%S}.json")
    return {"labels": {}}


def save(d: dict):
    tmp = JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, JSON)
    wb = Workbook()
    ws = wb.active
    ws.title = "labels"
    ws.append(["no", "image", "hallucination (1 = hallucination / N, 0 = passes / Y)", "note", "answered_at"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="23313B")
        c.alignment = Alignment(vertical="center")
    for n, f in enumerate(list_images(), 1):
        r = d["labels"].get(f, {})
        ws.append([n, f, r.get("hallucination"), r.get("note") or None, r.get("time")])
    for col, w in zip("ABCDE", (6, 48, 44, 40, 21)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    try:
        tmpx = BASE / "labels.tmp.xlsx"
        wb.save(tmpx)
        os.replace(tmpx, XLSX)
    except PermissionError:          # labels.xlsx is open in Excel; the JSON is saved, the xlsx is written next time
        pass


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if not ctype.startswith("image") else "max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if p == "/":
            return self.send(PAGE.encode("utf-8"), "text/html; charset=utf-8")
        if p == "/state":
            with LOCK:
                d = load()
            return self.send(json.dumps({"files": list_images(), "labels": d["labels"]}).encode(), "application/json")
        if p == "/open":
            os.startfile(str(BASE)) if hasattr(os, "startfile") else None
            return self.send(b"ok", "text/plain")
        if p.startswith("/img/"):
            f = IMG_DIR / Path(p[5:]).name
            if f.is_file():
                return self.send(f.read_bytes(), "image/png" if f.suffix.lower() == ".png" else "image/jpeg")
        self.send(b"not found", "text/plain", 404)

    def do_POST(self):
        try:
            r = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except Exception:  # noqa: BLE001
            return self.send(b"bad request", "text/plain", 400)
        with LOCK:
            d = load()
            if self.path == "/label":
                img = Path(str(r.get("image"))).name
                if r.get("hallucination") not in (0, 1, None) or not (IMG_DIR / img).is_file():
                    return self.send(b"bad request", "text/plain", 400)
                d["labels"][img] = {"hallucination": r.get("hallucination"), "note": str(r.get("note") or "")[:500],
                                    "time": datetime.now().isoformat(timespec="seconds")}
            else:
                return self.send(b"not found", "text/plain", 404)
            save(d)
        self.send(b"ok", "text/plain")


def main():
    if not IMG_DIR.is_dir():
        input(f'No "images" folder next to this program ({BASE}). Press Enter to close.')
        return
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://127.0.0.1:{port}/"
    print("Retify hallucination review is running.", flush=True)
    print(f"  Images : {len(list_images())} in {IMG_DIR}", flush=True)
    print(f"  Answers: {JSON.name} and {XLSX.name} in {BASE}", flush=True)
    print(f"  Page   : {url}  (opens in your browser)", flush=True)
    print("Keep this window open while reviewing. Close it when you are done.", flush=True)
    if not os.environ.get("RETIFY_NO_BROWSER"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
