#!/usr/bin/env python3
"""Slice tools/art/out/icons.png (4x4 UI/category icons) into
public/assets/icons/<name>.png, each fitted into a 32x32 frame.
Also crops the squirrel's sit frame to public/assets/favicon.png.

These are HTML-side icons (no manifest entry — the canvas never draws them).
"""
import os

from PIL import Image

from cutlib import ASSETS, OUT, grid_cells, to_alpha

# grid reading order; names are what game.js/index.html reference
NAMES = [
    "apple", "burger", "globe", "carrot",
    "car", "flag", "lion", "pizza",
    "palette", "ball", "icecream", "dog",
    "acorn", "hourglass", "book", "rocket",
]
FRAME = 32


def main():
    src = os.path.join(OUT, "icons.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs icons first")
    # dark bg vs dark outlines — key tightly, like the tree sheet
    sheet = to_alpha(Image.open(src), tolerance=16)
    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    for name, cell in zip(NAMES, grid_cells(sheet, 4, 4)):
        if cell is None:
            raise SystemExit(f"cell for {name} is empty — regenerate the sheet")
        scale = (FRAME - 2) / max(cell.width, cell.height)
        w = max(1, round(cell.width * scale))
        h = max(1, round(cell.height * scale))
        cell = cell.resize((w, h), Image.NEAREST)
        out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        out.alpha_composite(cell, ((FRAME - w) // 2, (FRAME - h) // 2))
        out.save(os.path.join(icon_dir, name + ".png"))
    print(f"wrote {len(NAMES)} icons to {icon_dir}")

    squirrel = os.path.join(ASSETS, "squirrel.png")
    if os.path.exists(squirrel):
        Image.open(squirrel).crop((0, 0, 32, 32)).save(
            os.path.join(ASSETS, "favicon.png"))
        print("wrote favicon.png (squirrel sit frame)")


if __name__ == "__main__":
    main()
