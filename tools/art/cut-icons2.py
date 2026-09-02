#!/usr/bin/env python3
"""Slice tools/art/out/icons2.png (second category-icon sheet) into
public/assets/icons/<name>.png. The generation came back 4x4 with a junk
bottom row — the 12 real icons are the first three rows."""
import os

from PIL import Image

from cutlib import ASSETS, OUT, grid_cells, to_alpha

NAMES = [
    "speech", "clapper", "guitar", "bolt",
    "tree", "pagoda", "kart", "gem",
    "toy", "controller", "building", "trophy",
]
FRAME = 32


def main():
    src = os.path.join(OUT, "icons2.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs icons2 first")
    sheet = to_alpha(Image.open(src), tolerance=16)  # dark bg, dark outlines
    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    cells = list(grid_cells(sheet, 4, 4))[:len(NAMES)]
    for name, cell in zip(NAMES, cells):
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


if __name__ == "__main__":
    main()
