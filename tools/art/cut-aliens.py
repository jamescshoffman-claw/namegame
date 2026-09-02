#!/usr/bin/env python3
"""Slice tools/art/out/aliens.png (2x2: ufo frame 1, ufo frame 2, walking
alien, eating alien) into game sprites, plus:

- icons/alien.png       UI icon (the walking alien)
- alienground.png       the alien planet surface — the earth ground strip
                        hue-rotated into purple/teal
"""
import os

from PIL import Image, ImageOps

from cutlib import ASSETS, OUT, grid_cells, merge_manifest, save_sprite, scale_to, to_alpha

UFO_W, UFO_H = 34, 26


def fit(cell, w, h):
    s = min((w - 2) / cell.width, (h - 2) / cell.height)
    c = cell.resize((max(1, round(cell.width * s)), max(1, round(cell.height * s))), Image.NEAREST)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(c, ((w - c.width) // 2, (h - c.height) // 2))
    return out


def alien_ground():
    src = os.path.join(ASSETS, "ground.png")
    if not os.path.exists(src):
        return None
    img = Image.open(src).convert("RGBA")
    a = img.getchannel("A")
    h, s, v = img.convert("HSV").split()
    h = h.point(lambda x: (x + 150) % 256)   # green grass -> purple, dirt -> teal
    s = s.point(lambda x: min(255, int(x * 1.15)))
    out = Image.merge("HSV", (h, s, v)).convert("RGBA")
    out.putalpha(a)
    return out


def red_ground():
    """Martian rock: the ground strip's luminance colorized dark-red to
    dusty orange — the recurring terrain of the red planet above branch 50."""
    src = os.path.join(ASSETS, "ground.png")
    if not os.path.exists(src):
        return None
    img = Image.open(src).convert("RGBA")
    a = img.getchannel("A")
    gray = ImageOps.autocontrast(img.convert("L"))
    out = ImageOps.colorize(gray, black=(52, 14, 12), white=(228, 122, 66),
                            mid=(150, 58, 34)).convert("RGBA")
    out.putalpha(a)
    return out


def main():
    src = os.path.join(OUT, "aliens.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs aliens first")
    # near-black bg vs dark outlines: key very tightly
    sheet = to_alpha(Image.open(src), tolerance=14)
    ufo1, ufo2, walk, eat = grid_cells(sheet, 2, 2)
    for name, cell in [("ufo1", ufo1), ("ufo2", ufo2), ("walk", walk), ("eat", eat)]:
        if cell is None:
            raise SystemExit(f"{name} cell is empty — regenerate the sheet")

    # UFO: two frames packed side by side in one sheet
    strip = Image.new("RGBA", (UFO_W * 2, UFO_H), (0, 0, 0, 0))
    strip.alpha_composite(fit(ufo1, UFO_W, UFO_H), (0, 0))
    strip.alpha_composite(fit(ufo2, UFO_W, UFO_H), (UFO_W, 0))
    os.makedirs(ASSETS, exist_ok=True)
    strip.save(os.path.join(ASSETS, "ufo.png"))
    entries = {
        "ufo": {
            "file": "ufo.png",
            "frames": [{"x": 0, "y": 0, "w": UFO_W, "h": UFO_H},
                       {"x": UFO_W, "y": 0, "w": UFO_W, "h": UFO_H}],
        },
        "alienwalk": save_sprite("alienwalk", scale_to(walk, h=20)),
        "alieneat": save_sprite("alieneat", scale_to(eat, h=18)),
    }

    ag = alien_ground()
    if ag is not None:
        entries["alienground"] = save_sprite("alienground", ag)
    rg = red_ground()
    if rg is not None:
        entries["redground"] = save_sprite("redground", rg)

    icon_dir = os.path.join(ASSETS, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    fit(walk, 32, 32).save(os.path.join(icon_dir, "alien.png"))

    merge_manifest(entries)


if __name__ == "__main__":
    main()
