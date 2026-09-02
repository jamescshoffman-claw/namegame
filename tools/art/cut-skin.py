#!/usr/bin/env python3
"""Slice a generated 2x2 pose sheet (sit, leap, crouch, land — the squirrel
layout) into a 4-frame skin strip + a 32x32 picker icon:

  python tools/art/cut-skin.py rabbit

Writes public/assets/<name>.png, public/assets/icons/skin-<name>.png and a
manifest entry. The game uses frame 0 (sit) and frame 1 (leap).
"""
import os
import sys

from PIL import Image

from cutlib import ASSETS, OUT, merge_manifest, to_alpha

FRAME = 32
CELLS = [(0, 0), (1, 0), (0, 1), (1, 1)]  # sit, leap, crouch, land


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python cut-skin.py <name>")
    name = sys.argv[1]
    src = os.path.join(OUT, name + ".png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs {name} first")
    sheet = to_alpha(Image.open(src))
    cw, ch = sheet.width // 2, sheet.height // 2

    out = Image.new("RGBA", (FRAME * len(CELLS), FRAME), (0, 0, 0, 0))
    for i, (cx, cy) in enumerate(CELLS):
        cell = sheet.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
        bbox = cell.getbbox()
        if not bbox:
            raise SystemExit(f"cell {i} is empty — regenerate the sheet")
        cell = cell.crop(bbox)
        scale = (FRAME - 2) / max(cell.width, cell.height)
        w, h = max(1, round(cell.width * scale)), max(1, round(cell.height * scale))
        cell = cell.resize((w, h), Image.NEAREST)
        out.alpha_composite(cell, (i * FRAME + (FRAME - w) // 2, FRAME - h))

    os.makedirs(ASSETS, exist_ok=True)
    out.save(os.path.join(ASSETS, name + ".png"))

    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    out.crop((0, 0, FRAME, FRAME)).save(os.path.join(icon_dir, f"skin-{name}.png"))

    merge_manifest({name: {
        "file": name + ".png",
        "frames": [{"x": i * FRAME, "y": 0, "w": FRAME, "h": FRAME} for i in range(len(CELLS))],
    }})


if __name__ == "__main__":
    main()
