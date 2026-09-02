#!/usr/bin/env python3
"""Slice tools/art/out/stump.png (single object) into public/assets/stump.png
— the perch the squirrel starts on at ground level."""
import os

from PIL import Image

from cutlib import OUT, merge_manifest, save_sprite, scale_to, to_alpha


def main():
    src = os.path.join(OUT, "stump.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs stump first")
    # dark bg vs dark outline — key tightly, like the tree sheet
    img = to_alpha(Image.open(src), tolerance=16)
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit("stump is empty — regenerate")
    merge_manifest({"stump": save_sprite("stump", scale_to(img.crop(bbox), w=32))})


if __name__ == "__main__":
    main()
