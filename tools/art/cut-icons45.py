#!/usr/bin/env python3
"""Slice tools/art/out/icons4.png and icons5.png (4x4 sheets) into
public/assets/icons/<name>.png. icons4 covers the Sep 11-18 categories;
icons5 finishes them and leaves spares (trophy2, key, heart, snowflake,
fish, coffee, bell, anchor, crown2) for future days."""
import os

from PIL import Image

from cutlib import ASSETS, OUT, grid_cells, to_alpha

SHEETS = {
    "icons4": [
        "bird", "cheese", "hero", "chocolate",
        "coin", "castle", "herb", "football",
        "pokeball", "dice", "map", "cereal",
        "planet", "wand", "lightsaber", "pasta",
    ],
    "icons5": [
        "flask", "soda", "dino", "tophat",
        "mushroom", "cocktail", "capitol", "trophy2",
        "key", "heart", "snowflake", "fish",
        "coffee", "bell", "anchor", "crown2",
    ],
}
FRAME = 32


def cut(sheet_name, names):
    src = os.path.join(OUT, sheet_name + ".png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs {sheet_name} first")
    sheet = to_alpha(Image.open(src), tolerance=16)
    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    for name, cell in zip(names, grid_cells(sheet, 4, 4)):
        if cell is None:
            raise SystemExit(f"cell for {name} is empty — regenerate {sheet_name}")
        scale = (FRAME - 2) / max(cell.width, cell.height)
        w = max(1, round(cell.width * scale))
        h = max(1, round(cell.height * scale))
        cell = cell.resize((w, h), Image.NEAREST)
        out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        out.alpha_composite(cell, ((FRAME - w) // 2, (FRAME - h) // 2))
        out.save(os.path.join(icon_dir, name + ".png"))
    print(f"wrote {len(names)} icons from {sheet_name}")


def main():
    import sys
    wanted = sys.argv[1:] or list(SHEETS)
    for sheet_name in wanted:
        cut(sheet_name, SHEETS[sheet_name])


if __name__ == "__main__":
    main()
