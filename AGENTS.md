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
- The repository variable `RETIFY_DATA_URL` is **not set yet**, so the live page says it has no image folder. The image dataset is staged on the workstation and waits for the owner's upload.
- Planned dataset: `hwang714/retify-eyepacs` (public), tag `v0.1.0`, one set `eyepacs-bad2good` with 801 cases. Once it exists, set the variable to `https://huggingface.co/datasets/hwang714/retify-eyepacs/resolve/v0.1.0/` and re-run the workflow (§6).
- Answers currently stay in the reviewer's browser and reach the lab only as a downloaded file. Sending them automatically to the lab is the next task (§7).

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
tests/serve.py          serves web/ at / and a data folder at /data/ (one origin, no CORS needed)
tests/e2e.mjs           headless-browser end-to-end test
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
- No name prompt and no tutorial pop-up on entry; the reviewer starts labelling at once. Help opens only from the `How to` button.
- Keys: `Y` = passes (0), `N` = hallucination (1), `←`/`→`, `Enter` enlarges. After an answer the next unanswered case opens.
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

## 7. Next task: send answers to the lab automatically

The owner chose: a small **relay on the lab machine**, reached through the lab's existing Cloudflare tunnel (the same tunnel that exposes RetiVASC's `/api/report`), which stores answers on the lab machine and copies them to a **private** Hugging Face dataset. GitHub was ruled out as the store; a write token in the public page was ruled out because anyone could copy it.

```
review page (browser) --POST each answer--> relay on lab machine --every few minutes--> HF private dataset
     keeps its own copy and a queue           validates, stores                       <set>/labels/<reviewer>.json
```

### 7.1 Relay service

Write it in this repository, e.g. `relay/` (FastAPI or the standard library; Python 3.10+), with its own settings file that git ignores (`relay/relay.local.json`; commit a `relay.local.example.json`). It runs as its own process on its own port on the lab machine. Follow RetiVASC's `retivasc_server/report.py` for the patterns already in use there: per-IP limits behind the tunnel (`CF-Connecting-IP`), an allow-list of page origins, secrets from an environment variable or a key file outside the repository.

Endpoints (all under `/api/retify/`, so one tunnel path rule `^/api/retify` covers them):

| Method | Path | Body / query | Does |
|---|---|---|---|
| GET | `/api/retify/status` | | `{ok, sets: [ids], version}`; the page uses it to show whether syncing is on |
| POST | `/api/retify/labels` | `{set, reviewer, answers: [{image, hallucination, note, time}]}` (a batch, 1–200 answers) | validates, stores, returns `{stored: n, server_time}` |
| GET | `/api/retify/labels?set=&reviewer=` | | that reviewer's current answers for the set, so a reviewer can continue on another computer |

Validation, each request:
- `set` is a set id in the manifest at `RETIFY_DATA_URL` (fetch it at start and every hour; cache it).
- `reviewer` matches `^[a-z0-9][a-z0-9-]{0,31}$` and is in the settings' reviewer list for that set (§7.3). Unknown codes get 403.
- every `image` is in that set's `cases`; `hallucination` is 0, 1 or null; `note` at most 500 characters; `time` an ISO date-time. Reject the whole batch with 400 on any bad item.
- body at most 256 KB; per IP at most a few requests a second and a few thousand answers a day; CORS only for `https://retinal-research.github.io` (and `http://127.0.0.1:*` for tests).

Storage on the lab machine (a data folder from the settings, outside the repository):
- `log/<set>/<reviewer>.jsonl`: every accepted answer appended, with the server's receive time and the caller's IP **hashed** (salted), never in clear. This log is never rewritten; it is the record.
- `current/<set>/<reviewer>.json`: the latest answer per image (later `time` wins, as the page's Load does).

Copy to Hugging Face:
- Private dataset, suggested `hwang714/retify-labels` (one repository for all sets), path `<set>/labels/<reviewer>.json`, same JSON as the page's download plus `reviewer`.
- Batch the uploads: at most one commit every 5 minutes, and only when something changed (one `create_commit` with all changed files). Hugging Face limits commit rates; never commit per answer.
- The token is a fine-grained token of the owner's account with write access to that one dataset only. Ask the owner for it; keep it in an environment variable or a key file with mode 600; never print or log it.
- If the upload fails, keep going and retry later; the local files are the source of truth.

Run it as a service that restarts on failure and on boot (systemd user unit or the method RetiVASC's server uses on that machine), and add the tunnel's public-hostname path rule. Exposing it through the tunnel opens it to the internet: confirm with the owner first.

### 7.2 Page changes

- `config.js` gets `window.RETIFY_LABELS_URL` (the relay base URL); the Pages workflow writes it from a new variable `RETIFY_LABELS_URL`. Without it, the page behaves as now (download only).
- The reviewer is identified by a code in the link, `?r=<code>`, which the lab gives each reviewer; there is still no name prompt. Without `?r=`, the page works locally only, as now. Show the code in the top bar ("Reviewer: dr1").
- Each answer is saved to `localStorage` first (as now), then added to an outbox (`localStorage["retify.outbox.<set>.<reviewer>"]`) and sent in batches; acknowledged items leave the outbox. Retry with back-off; send on `online` and on page load. Status in the top bar: "Synced to the lab", "Waiting to sync (n)", or red "Not synced — keep the page open or download answers".
- On load with `?r=`, fetch the reviewer's answers from the relay and merge them (later `time` wins), so a reviewer can switch computers.
- Keep `Download answers` and `Load answers` as the fallback.
- Keep the storage key per set and add the reviewer to it, so two reviewers in one browser do not mix.

### 7.3 Settings

```json
{
  "data_url": "https://huggingface.co/datasets/hwang714/retify-eyepacs/resolve/v0.1.0/",
  "data_dir": "/path/outside/the/repo/retify-labels",
  "host": "127.0.0.1", "port": 8096,
  "origins": ["https://retinal-research.github.io"],
  "reviewers": {"eyepacs-bad2good": ["dr1", "dr2", "dr3"]},
  "hf": {"repo": "hwang714/retify-labels", "token_env": "RETIFY_HF_TOKEN", "token_file": "", "every_minutes": 5}
}
```

Reviewer codes carry no names. The mapping from code to person stays with the owner, not in this repository or on Hugging Face.

### 7.4 Tests to add

- Relay unit tests: validation (bad set, unknown reviewer, image not in set, bad value, oversize body), later-time-wins merge, log append-only, HF upload batching with a fake uploader, CORS headers.
- Extend `tests/e2e.mjs`: run the relay locally with a fake uploader, answer cases with `?r=test`, stop the relay (answers queue), restart it (queue drains), open in a fresh profile (answers come back from the relay).

## 8. Rules

1. **Only EyePACS images may ever be published.** The owner's other data (any study cohort, any hospital photograph) must never be uploaded to Hugging Face, GitHub, or any other service, and must never appear in this repository: not as images, file names, paths, counts, or examples. `tools/make_dataset.py` refuses file names that are not EyePACS names (`<number>_left|right`); do not weaken that check. If you are unsure whether something is EyePACS, stop and ask.
2. Images and answers never go into git. `.gitignore` excludes images, spreadsheets and label files; check `git status` before every commit.
3. The code is MIT; the images are not covered by it and follow the EyePACS terms. Keep them in separate places, as now.
4. Everything in this repository is in English: code, comments, docs, commit messages.
5. Commit messages and PR descriptions carry **no AI attribution** (no `Co-Authored-By` lines). The README already has the one acknowledgement sentence.
6. No secrets, tunnel hostnames, machine paths or reviewer identities in the repository. Secrets live in environment variables or key files; hostnames go into repository variables.
7. Do not open anything on the lab machine to the network, or change who can reach it, without the owner's go-ahead.
8. Reviewer-facing behaviour (§5) was chosen by the owner; ask before changing it.

## 9. Checking your work

```bash
python tests/serve.py <a data folder>              # e.g. a staging folder from make_dataset.py
node tests/e2e.mjs "http://127.0.0.1:8811/?data=/data/" /tmp/retify-e2e   # all lines "ok", exit 0
```

A small data folder for tests can be made from any few EyePACS JPEGs with `tools/make_dataset.py`. Screenshots land in the output folder; look at them after any visual change, at desktop width and at phone width (`node tests/e2e.mjs <url> <out> 420 900 shot-only`).
