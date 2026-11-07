# Retify — guide for agents

This file is for an AI agent (or a person) who maintains Retify: what it is, how it is built and published, the rules that must not be broken, and the work that is planned next. Read it whole before changing anything. The README is the short version for visitors.

## 1. What Retify is

Enhancement models (here, the lab's TPOT generator fine-tuned on EyePACS) can turn a poor fundus photograph into a clear one, but they can also **hallucinate**: invent vessels, drop vessels, or bend them. Vessel measurements taken from such a photograph are then wrong. Retify collects expert judgements of which enhanced photographs can be trusted; the labels will train a detector that flags the ones that cannot.

Reviewers (ophthalmologists) answer one question per case, at the level of the whole image:

> Is the ENHANCED image free of hallucinations? **Yes** = passes (label 0), **No** = hallucination (label 1).

Each case is one pre-rendered JPEG with four panels (A original, B enhanced, C automatic vessel-change map, D close-ups of four boxes). The panels are made offline on the lab workstation and are not this repository's concern; this repository only shows them and collects the answers.

## 2. Who does what

| Part | Owner |
|---|---|
| This repository: the review page, the Pages workflow, the planned label relay, tests, docs | **the lab agent** (the agent reading this, on the lab machine) |
| Making review images (enhancement, vessel maps, four-panel JPEGs), choosing which cases to review, building and uploading the Hugging Face image datasets | the workstation agent, with the project owner |
| Decisions: which data may be public, opening anything to the network, who reviews | the project owner (hwang714 on Hugging Face) |

When a new image set appears on Hugging Face, the workstation side tells you its id and version tag; your part is the repository variable and the page.

## 3. Current state (2026-11-03)

- Repository: https://github.com/Retinal-Research/Retify, branch `main`. Licence MIT (code only; see §8).
- Site: https://retinal-research.github.io/Retify/, GitHub Pages with source "GitHub Actions", deployed by `.github/workflows/pages.yml` on every push to `main`.
- Image data: Hugging Face dataset `hwang714/retify-eyepacs` (public), tag `v0.1.0`, one set `eyepacs-bad2good` with 801 cases. The repository variable `RETIFY_DATA_URL` is `https://huggingface.co/datasets/hwang714/retify-eyepacs/resolve/v0.1.0/`; the live site shows the cases, and `tests/e2e.mjs` passes against it.
- The relay (§7) is written and tested (`relay/relay.py`): reviewers enter by name, answers go to the lab as they are made, everyone sees everyone's progress but not their answers. Until it runs behind the tunnel and `RETIFY_LABELS_URL` is set, the live page keeps answers in the browser as before.

## 4. Repository layout

```
web/                 the site, static files, no build step
  index.html         markup; loads config.js, xlsx.js, app.js
  app.js             all page logic
  xlsx.js            minimal .xlsx writer and reader (window.XLSX_MINI), no dependencies
  style.css          styles; narrow screens (<900 px) stack the queue under the case
  config.js          window.RETIFY_DATA_URL; rewritten by the Pages workflow
  favicon.svg
tools/make_dataset.py   builds/extends an image dataset folder; refuses non-EyePACS file names
local/label_tool.py     offline version: same page served on 127.0.0.1, answers written to labels.xlsx/json
relay/relay.py          the lab's relay: sessions by name, answers, progress, backup to a private HF dataset
relay/relay.local.example.json   its settings (the real relay.local.json is git-ignored)
tests/serve.py          serves web/ at / and a data folder at /data/ (one origin, no CORS needed)
tests/e2e.mjs           headless-browser end-to-end test, without the relay
tests/e2e_relay.mjs     the same with the relay: sessions, sync, progress, the outbox when the relay is down
tests/test_relay.py     the relay's unit tests
.github/workflows/pages.yml
```

## 5. How the page works

**Data folder.** The page fetches `<DATA>manifest.json`:

```json
{"sets": [{"id": "eyepacs-bad2good", "title": "EyePACS: poor photos rated good after enhancement",
           "dir": "eyepacs_bad2good/images/", "cases": ["13026_right.jpg", "40362_right.jpg", "..."]}]}
```

`cases` is the review order (shuffled on purpose). Image URL = `DATA + dir + encodeURIComponent(name)`. `DATA` comes from `?data=<url>` in the address, else `window.RETIFY_DATA_URL`. `?set=<id>` picks a set; with several sets the queue shows a menu.

**State.** `files` (case names), `lab` (answers), `i` (current case). An answer is `{hallucination: 0|1|null, note, time}` keyed by image file name; `time` is local ISO time to the second. `null` means a note without an answer.

**Storage.** `localStorage["retify.labels.<set id>"] = {"set": id, "labels": lab}`, written after every answer and 0.5 s after typing in the note. If storage fails, the status in the top bar turns red and asks the reviewer to download.

**Download.** `Download answers` offers Excel (`retify_labels_<set>_<date>.xlsx`), CSV (UTF-8 with BOM) and JSON. Columns: `no`, `image`, `hallucination (1 = hallucination / N, 0 = passes / Y)`, `note`, `answered_at`; one row per case in review order, unanswered rows empty. JSON: `{set, data, exported_at, labels}`.

**Load.** `Load answers` reads any of the three formats (columns found by header name; `.xlsx` re-saved by Excel works, via `DecompressionStream`). For each case it keeps the answer with the later `time`. Rows that are not cases of the current set are skipped and counted.

**Behaviour the owner asked for — keep it:**
- A short welcome on the first visit in a browser (2026-11-07, the owner's request; `retify.welcomed` in localStorage), then help only from the `How to` button. Without a relay there is no name prompt: the reviewer starts labelling at once.
- Plain words, no new concepts (the owner's request): blue = "new vessel", red = "lost vessel"; vessels "added, lost, moved or bent". No "lab", "server" or other technical terms on the page.
- With a relay (2026-11-07, the owner's choice): the reviewer types their name (last name, first name, or either). Sessions whose name shares a word with it are offered ("These sessions were found … Enter yours?"); otherwise "No session was found … Create a new one?". Typos make stray sessions; the owner tidies them. "Continue without saving to the lab" keeps the old browser-only behaviour.
- Everyone sees everyone's progress (cases answered per session), never anyone's answers, so that each case is judged independently.
- Keys: `Y` = passes (0), `N` = hallucination (1), `←`/`→`, `Enter` full size, `0` reset view. After an answer the next unanswered case opens.
- The picture is a small canvas (2026-11-07, the owner's request): scroll zooms at the pointer, drag moves, never smaller than it fits (up to 8×); double-click or **Reset view** goes back; each case opens whole.
- Typing a number in "Go to": a case number if it is within range, otherwise part of a file name (EyePACS names are numbers too).
- The same look and wording as the offline tool in `local/label_tool.py`; keep the two in step when the wording changes.

## 6. Publishing

**Site.** Push to `main`. `pages.yml` rewrites `web/config.js` from `vars.RETIFY_DATA_URL` (when set), checks that `manifest.json` answers with an `Access-Control-Allow-Origin` header and that the first image exists, and deploys `web/`. Without the variable it deploys the page as is.

```bash
gh variable set RETIFY_DATA_URL -R Retinal-Research/Retify \
  --body "https://huggingface.co/datasets/hwang714/retify-eyepacs/resolve/v0.1.0/"
gh workflow run pages -R Retinal-Research/Retify
gh run watch -R Retinal-Research/Retify
```

Then open the live site and check that case 1's picture shows (or run `tests/e2e.mjs` against the live URL plus `?data=...` if needed).

**Image data.** Always pin a tag (`resolve/v0.1.0/`), never `resolve/main/`: reviewers must not see cases change under them, and a reviewer's answers are keyed by file name within a set. A new or changed set gets a new tag, and the variable moves to it. Building a dataset (workstation side):

```bash
python tools/make_dataset.py --images <folder of review JPEGs> --order <order.txt> --out <staging folder> \
    --id eyepacs-bad2good --title "EyePACS: poor photos rated good after enhancement"
hf upload hwang714/retify-eyepacs <staging folder> . --repo-type dataset
hf repo tag create hwang714/retify-eyepacs v0.1.0 --repo-type dataset
```

## 7. The relay: answers to the lab as they are made

Built 2026-11-07 (`relay/relay.py`, Python standard library; the backup needs `huggingface_hub`).

```
review page (browser) --each answer--> Cloudflare tunnel, /api/retify/* only --> relay on the lab machine (port 8096)
  keeps its own copy and an outbox                                               stores, logs  --every 5 min--> private HF dataset
```

**Sessions.** The owner chose names over invitation links. `POST /sessions/find {name}` lists sessions sharing a word of the name (case, accents and punctuation ignored); `POST /sessions {name}` creates one; `POST /sessions/enter {id}` enters one. Creating or entering returns a key for that browser; the relay keeps only its hash. Answers are accepted only with a key of their session, so one browser cannot write into another session by accident. Anyone who types another reviewer's name can still enter that session: the protection against tampering is the log, not the door.

**Answers.** `POST /labels {set, session, answers: [{image, hallucination, note, time}]}` with header `X-Retify-Key`, 1–200 at a time; `GET /labels?set=&session=` returns the session's answers, so a reviewer can continue on another computer. Validation: the set and every image are in the manifest at `data_url` (fetched hourly, cached for offline), `hallucination` 0, 1 or null, a note of at most 500 characters, an ISO time; one bad item rejects the batch. The later `time` wins, as the page's Load does. `GET /progress?set=` gives each session's count of answers, never the answers; sessions without answers are left out. `GET /status` says it is up.

**Files** (in `data_dir`, outside the repository): `sessions.json` (names, created, key hashes), `log/<set>/<session>.jsonl` (every accepted answer, appended, never rewritten, with the receive time and a salted hash of the caller's IP), `current/<set>/<session>.json` (latest per image).

**Backup.** Every `every_minutes` minutes, when something changed, one commit to the private dataset (`hf.repo`) with the changed files; `sessions.json` goes without the key hashes. A failed upload is retried; the files on the lab machine are the record. The token is a fine-grained token with write access to that dataset only, in `token_env` or `token_file` (mode 600), never printed.

**Limits.** CORS for `origins` only (`http://127.0.0.1:*` allowed for tests); 10 requests a second per IP (`CF-Connecting-IP` behind the tunnel); 5000 answers and 50 new sessions per IP a day; 256 KB a request.

**The page.** `RETIFY_LABELS_URL` (repository variable, written into `config.js` by the workflow) or `?relay=` turns it on. The session is kept in `localStorage["retify.session"]`; answers in `retify.labels.<set>.<session>` and, until the relay confirms them, in `retify.outbox.<set>.<session>`, sent in batches with back-off and on `online`. The top bar shows the reviewer (with Switch) and "Saved to the lab", "Saving…", or red "Not yet saved to the lab (n waiting)". On entering, the relay's answers and the browser's are merged (later wins). Progress refreshes every 15 s.

**Deploying on the lab machine** (each step the owner's go-ahead, rule 7):
1. `relay/relay.local.json` from the example; a Python with `huggingface_hub` for the backup.
2. A service that starts at boot and restarts on failure (the lab machine uses system LaunchDaemons running as the owner's user, like RetiVASC's server).
3. The tunnel's public hostname gets a path rule `^/api/retify/` to `http://localhost:8096`.
4. The private dataset and its token.
5. `gh variable set RETIFY_LABELS_URL -R Retinal-Research/Retify --body "https://<host>/api/retify"`, then push or run the workflow.

**Tests.** `python tests/test_relay.py`; `node tests/e2e_relay.mjs <data folder> <output folder>` starts the page server and a relay itself.

## 8. Rules

1. **Only EyePACS images may ever be published.** The owner's other data (any study cohort, any hospital photograph) must never be uploaded to Hugging Face, GitHub, or any other service, and must never appear in this repository: not as images, file names, paths, counts, or examples. `tools/make_dataset.py` refuses file names that are not EyePACS names (`<number>_left|right`); do not weaken that check. If you are unsure whether something is EyePACS, stop and ask.
2. Images and answers never go into git. `.gitignore` excludes images, spreadsheets and label files; check `git status` before every commit.
3. The code is MIT; the images are not covered by it and follow the EyePACS terms. Keep them in separate places, as now.
4. Everything in this repository is in English: code, comments, docs, commit messages.
5. Commit messages and PR descriptions carry **no AI attribution** (no `Co-Authored-By` lines). The README already has the one acknowledgement sentence.
6. No secrets, tunnel hostnames, machine paths or reviewer names in the repository. Reviewer names live only on the lab machine and in the private dataset. Secrets live in environment variables or key files; hostnames go into repository variables.
7. Do not open anything on the lab machine to the network, or change who can reach it, without the owner's go-ahead.
8. Reviewer-facing behaviour (§5) was chosen by the owner; ask before changing it.

## 9. Checking your work

```bash
python tests/serve.py <a data folder>              # e.g. a staging folder from make_dataset.py
node tests/e2e.mjs "http://127.0.0.1:8811/?data=/data/" /tmp/retify-e2e   # all lines "ok", exit 0
```

A small data folder for tests can be made from any few EyePACS JPEGs with `tools/make_dataset.py`. Screenshots land in the output folder; look at them after any visual change, at desktop width and at phone width (`node tests/e2e.mjs <url> <out> 420 900 shot-only`).
