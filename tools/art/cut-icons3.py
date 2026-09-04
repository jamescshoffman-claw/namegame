#!/usr/bin/env python3
"""Slice tools/art/out/icons3.png (2x2: flower, sneaker, crown, star)
into public/assets/icons/<name>.png. Crown and star are spares for
future categories."""
import os

from PIL import Image

from cutlib import ASSETS, OUT, grid_cells, to_alpha

NAMES = ["flower", "sneaker", "crown", "star2"]
FRAME = 32


def main():
    src = os.path.join(OUT, "icons3.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs icons3 first")
    sheet = to_alpha(Image.open(src), tolerance=16)
    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    for name, cell in zip(NAMES, grid_cells(sheet, 2, 2)):
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
