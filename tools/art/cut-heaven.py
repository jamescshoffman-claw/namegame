#!/usr/bin/env python3
"""Slice tools/art/out/heaven.png (2x2: angel wings up, angel wings down,
pearly gates, greek temple) into game sprites + icons/angel.png."""
import os

from PIL import Image

from cutlib import ASSETS, OUT, grid_cells, merge_manifest, save_sprite, scale_to, to_alpha

ANGEL_W, ANGEL_H = 30, 28


def fit(cell, w, h):
    s = min((w - 2) / cell.width, (h - 2) / cell.height)
    c = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))), Image.NEAREST)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(c, ((w - c.width) // 2, (h - c.height) // 2))
    return out


def main():
    src = os.path.join(OUT, "heaven.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs heaven first")
    sheet = to_alpha(Image.open(src))  # flat blue bg keys at default tolerance
    up, down, gates, temple = grid_cells(sheet, 2, 2)
    for name, cell in [("up", up), ("down", down), ("gates", gates), ("temple", temple)]:
        if cell is None:
            raise SystemExit(f"{name} cell is empty — regenerate the sheet")

    strip = Image.new("RGBA", (ANGEL_W * 2, ANGEL_H), (0, 0, 0, 0))
    strip.alpha_composite(fit(up, ANGEL_W, ANGEL_H), (0, 0))
    strip.alpha_composite(fit(down, ANGEL_W, ANGEL_H), (ANGEL_W, 0))
    os.makedirs(ASSETS, exist_ok=True)
    strip.save(os.path.join(ASSETS, "angel.png"))
    entries = {
        "angel": {
            "file": "angel.png",
            "frames": [{"x": 0, "y": 0, "w": ANGEL_W, "h": ANGEL_H},
                       {"x": ANGEL_W, "y": 0, "w": ANGEL_W, "h": ANGEL_H}],
        },
        "gates": save_sprite("gates", scale_to(gates, w=104)),
        "temple": save_sprite("temple", scale_to(temple, w=84)),
    }

    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    fit(up, 32, 32).save(os.path.join(icon_dir, "angel.png"))

    merge_manifest(entries)


if __name__ == "__main__":
    main()
