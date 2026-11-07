# Retify

**Hallucination review for enhanced fundus photographs** · [Geometry Systems Lab](https://gsl.lab.asu.edu/), Arizona State University

| | |
|---|---|
| Review page (no install) | https://retinal-research.github.io/Retify/ |
| Code | https://github.com/Retinal-Research/Retify |
| Review images on Hugging Face | [hwang714/retify-eyepacs](https://huggingface.co/datasets/hwang714/retify-eyepacs) |
| Related | [RetiVASC](https://github.com/Retinal-Research/RetiVASC) · [TPOT-SR](https://github.com/Retinal-Research/TPOT-SR) |

Enhancement models can make a poor fundus photograph look clear, but they can also invent vessels, drop vessels or bend them. Measurements of the vessel tree taken from such a photograph would then be wrong. Retify collects expert judgements of which enhanced photographs can be trusted, so that a detector can later learn to flag the ones that cannot.

Reviewers judge one question per case:

> **Does the enhanced photo show only real vessels?**
> A computer made the original photo (A) clearer (B). Yes if every vessel in B is real; No if it made any up.

The words of the task (the question, the sentence under it, the introduction, the two buttons) and the guidelines, what is fine and what is not, live in [`web/guidelines.json`](web/guidelines.json): the page reads them from there, the guidelines in short in the bar above the photo and in full under **How to**. To change them, edit that file on GitHub and commit to `main`; the page is republished about a minute later. A file that is not valid JSON is refused at publishing, and the page keeps the last good guidelines.

Each case is one picture with four panels:

| Panel | Shows |
|---|---|
| **A** | the original photograph |
| **B** | the enhanced photograph, the one to judge |
| **C** | the vessels of both photographs, traced by a computer. Green = in both, blue = new vessel, red = lost vessel |
| **D** | close-ups of the yellow boxes 1–4: original, enhanced, enhanced with outlines, red-free original |

The automatic tracing only points to where to look; the reviewer's judgement of the photographs decides.

## Reviewing

Open the review page. There is nothing to install and no account.

- A new reviewer gets a short welcome after typing their name. In panel C, **blue** = new vessel, **red** = lost vessel and **green** = in both; the colors are also shown in a small box on the picture. The guidelines in short sit in the bar above the picture; **How to** has them in full.
- **Bright or dark**: the page starts bright; the eye at the top left switches it, and the line under the eye says which one it switches to.
- The strip under the top bar shows everyone's progress, with names partly hidden (e.g., Ti*a).
- Click **Yes** or **No** under the picture, or press <kbd>Y</kbd> / <kbd>N</kbd>. The next case still to do opens.
- <kbd>←</kbd> <kbd>→</kbd> move between cases; any annotation can be changed. Scroll on the picture to zoom in and drag to move around; double-click it or click **Reset view** to see it whole. **Full size** (or <kbd>Enter</kbd>) opens it on the whole screen.
- The list on the left shows every case: orange = to do, green = Yes, red = No. "Go to" takes a case number or a file name.
- An optional note can be typed for each case.

**Annotations are saved automatically.** The first time, the page asks for your name (e.g., Tina) and finds your session; if there is none, it asks for your full name (e.g., Tina Vascullensky) and starts a new one. To continue on another computer, type the same name there. Everyone sees how many cases each reviewer has annotated, never their annotations. Without a connection, annotations are kept on your computer and saved when the connection is back.

**Continue Without Saving** keeps every annotation only in that browser on that computer; download them when you finish and send us the file. The page can be closed at any time and continues where it stopped. When finished, click **Download annotations** and send the Excel file (CSV and JSON are also offered). To move to another computer, download the annotations, then use **Load annotations** there; it reads the Excel, CSV or JSON file and keeps the newer annotation for each case.

The annotations file has one row per case: `no`, `image`, `hallucination` (1 = made-up vessels, the No button; 0 = only real vessels, Yes; empty = not annotated), `note`, `annotated_at`. Files from before 2026-11-07 name the last column `answered_at`; Load reads both.

## Image sets

| Set | Cases | What it is |
|---|---|---|
| `eyepacs-bad2good` | 801 | EyePACS photographs that AutoMorph grades as poor quality and, after enhancement, as good. The order of cases is shuffled. |

The photographs are from the EyePACS test set of the Kaggle Diabetic Retinopathy Detection challenge; file names are the EyePACS image names. With several sets in the data, the page shows a menu, and `?set=<id>` in the address opens one directly.

## How it works

The site is three static files in [`web/`](web/) (`index.html`, `app.js`, `style.css`, plus a small Excel reader and writer in `xlsx.js`) with no build step and no server. The images are not part of the repository or the site. They live in a data folder:

```
manifest.json                      {"sets": [{"id", "title", "dir", "cases": [file names, in review order]}]}
<set>/images/<file name>.jpg       one picture per case
README.md                          dataset card
```

The page reads the data folder from `web/config.js`; a `?data=<url>` parameter in the address overrides it. The published data folder is the Hugging Face dataset at a version tag, so the cases do not change under a reviewer.

### Running it locally

```
python tests/serve.py <data folder>
```

serves the page and a local data folder from one address; open `http://127.0.0.1:8811/?data=/data/`. With a Hugging Face data URL, any static server works: `python -m http.server 8000 --directory web`, then `http://localhost:8000/?data=<URL>`. `node tests/e2e.mjs <page URL> <output folder>` runs the whole review in a headless Chrome or Edge and checks it.

Maintainers and agents: [AGENTS.md](AGENTS.md) describes the design, the publishing steps, the rules, and the relay (`relay/relay.py`) that keeps the annotations on the lab's server.

### Publishing images

Only photographs that may be published can go into the data folder. [`tools/make_dataset.py`](tools/make_dataset.py) builds or extends it and, by default, refuses any file whose name is not an EyePACS image name:

```
python tools/make_dataset.py --images <folder of review pictures> --order <order.txt> --out <staging folder> \
    --id eyepacs-bad2good --title "EyePACS: poor photos rated good after enhancement"
hf upload hwang714/retify-eyepacs <staging folder> . --repo-type dataset
hf repo tag create hwang714/retify-eyepacs v0.1.0 --repo-type dataset
```

### Deploying

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes `web/` to GitHub Pages on every push to `main`. It writes `web/config.js` from the repository variable `RETIFY_DATA_URL` (here `https://huggingface.co/datasets/hwang714/retify-eyepacs/resolve/v0.1.0/`) and first checks that the manifest and the first image are reachable from a browser. Without the variable the page is still published and says that it has no image folder. In the repository settings, Pages must use "GitHub Actions" as its source.

## Offline version

[`local/label_tool.py`](local/label_tool.py) is the same review page for a reviewer without a reliable connection. It serves a folder of pictures (`images/`, optional `order.txt`) on 127.0.0.1 and writes `labels.xlsx` and `labels.json` next to itself after every annotation. It still has the wording and rule from before 2026-11-07. Packed with PyInstaller it is a single program the reviewer double-clicks:

```
pip install openpyxl pyinstaller
pyinstaller --onefile --console --name Retify_Label local/label_tool.py
```

## Licence and acknowledgements

Retify's code is released under the MIT License (see [LICENSE](LICENSE)). The review images are kept apart from the code, in the Hugging Face dataset, and the code licence does not cover them: they derive from EyePACS photographs, and their use is subject to the EyePACS terms.

Vessel tracing and quality grades come from [AutoMorph](https://github.com/rmaphoh/AutoMorph):

> Zhou Y, Wagner SK, Chia MA, et al. AutoMorph: Automated Retinal Vascular Morphology Quantification Via a Deep Learning Pipeline. *Translational Vision Science & Technology* 11(7):12, 2022. https://doi.org/10.1167/tvst.11.7.12

Parts of the code and documentation were written with the help of Claude, an AI assistant by Anthropic.
