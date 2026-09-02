#!/usr/bin/env python3
"""Slice tools/art/out/backdrops.png (3x3 sky/space elements) into
individual sprites + manifest entries."""
import os

from PIL import Image

from cutlib import OUT, grid_cells, merge_manifest, save_sprite, scale_to, to_alpha

# (manifest key, target width) in grid reading order
PLAN = [
    ("sun", 52), ("cloud1", 48), ("cloud2", 52),
    ("moon", 32), ("star", 11), ("planet1", 36),
    ("planet2", 26), ("planet3", 32), ("galaxy", 40),
]


def main():
    src = os.path.join(OUT, "backdrops.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs backdrops first")
    sheet = to_alpha(Image.open(src))
    entries = {}
    for (name, w), cell in zip(PLAN, grid_cells(sheet, 3, 3)):
        if cell is None:
            raise SystemExit(f"cell for {name} is empty — regenerate the sheet")
        entries[name] = save_sprite(name, scale_to(cell, w=w))
    merge_manifest(entries)


if __name__ == "__main__":
    main()
