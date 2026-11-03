"""Build (or add to) the data folder that the review page reads: manifest.json plus one folder of images per set.

The folder is then uploaded as a Hugging Face dataset, for example:
    python tools/make_dataset.py --images <dir of review JPGs> --order <order.txt> --out <staging dir> \
        --id eyepacs-bad2good --title "EyePACS: poor photos rated good after enhancement"
    hf upload <owner>/<repo> <staging dir> . --repo-type dataset
    hf repo tag create <owner>/<repo> v0.1.0 --repo-type dataset

Only publishable photographs may go in. By default every file name must look like an EyePACS file name
(<number>_left / <number>_right); anything else stops the build. Change --allow only for another public dataset.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

EYEPACS = r"^\d+_(left|right)\.(jpe?g|png)$"

CARD = """---
license: other
license_name: eyepacs
pretty_name: Retify review images
task_categories:
- image-classification
tags:
- medical
- retina
- fundus
- image-enhancement
- hallucination
size_categories:
- n<1K
---

# Retify review images

Review images for [Retify](https://github.com/Retinal-Research/Retify), which asks reviewers one question per
case: does the enhanced fundus photograph contain hallucinations (vessels that are invented, missing,
displaced or distorted compared with the original)?

Each image has four panels:

- **A** the original photograph;
- **B** the enhanced photograph (the one to judge);
- **C** vessel changes: vessels traced automatically in both photographs; green = in both,
  blue = only after enhancement, red = lost after enhancement;
- **D** close-ups of the yellow boxes 1–4: original, enhanced, enhanced with outlines, red-free original.

`manifest.json` lists the image sets and the order in which cases are shown.

## Source

The photographs are from the EyePACS test set of the Kaggle Diabetic Retinopathy Detection challenge.
File names are the EyePACS image names. Use of the images is subject to the EyePACS terms.
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", required=True, type=Path, help="folder of review images")
    ap.add_argument("--out", required=True, type=Path, help="staging folder (created or added to)")
    ap.add_argument("--id", required=True, help="set id, e.g. eyepacs-bad2good")
    ap.add_argument("--title", required=True, help="set title shown on the page")
    ap.add_argument("--order", type=Path, help="text file, one image name per line (others follow sorted)")
    ap.add_argument("--allow", default=EYEPACS, help="regular expression every file name must match")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", a.id):
        sys.exit("--id: lower-case letters, digits and '-' only")
    names = sorted(p.name for p in a.images.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    bad = [n for n in names if not re.match(a.allow, n)]
    if bad:
        sys.exit(f"{len(bad)} file names do not match --allow (first: {bad[:5]}); nothing was written")
    if not names:
        sys.exit("no images found")
    if a.order:
        have = set(names)
        listed = [l.strip() for l in a.order.read_text(encoding="utf-8").splitlines() if l.strip() in have]
        names = listed + sorted(have - set(listed))

    sub = a.id.replace("-", "_") + "/images"
    dst = a.out / sub
    dst.mkdir(parents=True, exist_ok=True)
    for n in names:
        if not (dst / n).exists():
            shutil.copy2(a.images / n, dst / n)

    man = a.out / "manifest.json"
    m = json.loads(man.read_text(encoding="utf-8")) if man.exists() else {"sets": []}
    m["sets"] = [s for s in m["sets"] if s["id"] != a.id] + [{"id": a.id, "title": a.title, "dir": sub + "/",
                                                             "cases": names}]
    man.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if not (a.out / "README.md").exists():
        (a.out / "README.md").write_text(CARD, encoding="utf-8")
    print(f"{a.id}: {len(names)} images -> {dst}")


if __name__ == "__main__":
    main()
