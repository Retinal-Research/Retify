# Retify

**Hallucination review for enhanced fundus photographs** · [Geometry Systems Lab](https://gsl.lab.asu.edu/), Arizona State University

| | |
|---|---|
| Review page (no install) | https://retinal-research.github.io/Retify/ |
| Code | https://github.com/Retinal-Research/Retify |
| Review images on Hugging Face | [hwang714/retify-eyepacs](https://huggingface.co/datasets/hwang714/retify-eyepacs) |
| Related | [RetiVASC](https://github.com/Retinal-Research/RetiVASC) · [TPOT-SR](https://github.com/Retinal-Research/TPOT-SR) |

Enhancement models can make a poor fundus photograph look clear, but they can also invent vessels, drop vessels or bend them. Measurements of the vessel tree taken from such a photograph would then be wrong. Retify collects expert judgements of which enhanced photographs can be trusted, so that a detector can later learn to flag the ones that cannot.

Reviewers answer one question per case:

> **Is the ENHANCED image free of hallucinations?**
> Yes = passes. No = hallucination: vessels that are invented, missing, displaced or distorted compared with the original.

Each case is one picture with four panels:

| Panel | Shows |
|---|---|
| **A** | the original photograph |
| **B** | the enhanced photograph, the one to judge |
| **C** | vessel changes: vessels traced automatically in both photographs. Green = in both, blue = only after enhancement, red = lost after enhancement |
| **D** | close-ups of the yellow boxes 1–4: original, enhanced, enhanced with outlines, red-free original |

The automatic tracing only points to where to look; the reviewer's judgement of the photographs decides.

## Reviewing

Open the review page. There is nothing to install and no account.

- Click **Yes** or **No** under the picture, or press <kbd>Y</kbd> / <kbd>N</kbd>. The next unanswered case opens.
- <kbd>←</kbd> <kbd>→</kbd> move between cases; any answer can be changed. Click the picture (or press <kbd>Enter</kbd>) to see it full size.
- The list on the left shows every case: orange = to do, green = passes, red = hallucination. "Go to" takes a case number or a file name.
- An optional note can be typed for each case.

**Answers stay in the browser.** Every answer is kept in that browser on that computer (local storage) and is never uploaded. The page can be closed at any time and continues where it stopped. When finished, click **Download answers** and send the Excel file (CSV and JSON are also offered). To move to another computer, download the answers, then use **Load answers** there; it reads the Excel, CSV or JSON file and keeps the newer answer for each case.

The answers file has one row per case: `no`, `image`, `hallucination` (1 = hallucination, 0 = passes, empty = not answered), `note`, `answered_at`.

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
python -m http.server 8000 --directory web
```

then open `http://localhost:8000/?data=<data folder URL>`. The data folder must be reachable from the browser: a Hugging Face URL works directly, and a local folder can be served by the same kind of server on another port only if it sends CORS headers, so the simplest local test is to place the data folder inside `web/` (it is git-ignored) and use `?data=data/`.

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

[`local/label_tool.py`](local/label_tool.py) is the same review page for a reviewer without a reliable connection. It serves a folder of pictures (`images/`, optional `order.txt`) on 127.0.0.1 and writes `labels.xlsx` and `labels.json` next to itself after every answer. Packed with PyInstaller it is a single program the reviewer double-clicks:

```
pip install openpyxl pyinstaller
pyinstaller --onefile --console --name Retify_Label local/label_tool.py
```

## Licence and acknowledgements

Retify's code is released under the MIT License (see [LICENSE](LICENSE)). The review images are kept apart from the code, in the Hugging Face dataset, and the code licence does not cover them: they derive from EyePACS photographs, and their use is subject to the EyePACS terms.

Vessel tracing and quality grades come from [AutoMorph](https://github.com/rmaphoh/AutoMorph):

> Zhou Y, Wagner SK, Chia MA, et al. AutoMorph: Automated Retinal Vascular Morphology Quantification Via a Deep Learning Pipeline. *Translational Vision Science & Technology* 11(7):12, 2022. https://doi.org/10.1167/tvst.11.7.12

Parts of the code and documentation were written with the help of Claude, an AI assistant by Anthropic.
