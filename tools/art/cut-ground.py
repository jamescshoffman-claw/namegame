#!/usr/bin/env python3
"""Slice tools/art/out/ground.png into a full-width ground strip.

The generation has sky above the grass; key ONLY the sky out (flood fill
seeded from the top edge) so the amber between grass blades goes clear while
the dirt — whatever its color — stays. Scales to the game's 320px width.
"""
import os

from PIL import Image

from cutlib import BG_TOLERANCE, OUT, merge_manifest, save_sprite, scale_to


def key_sky(img, tolerance=BG_TOLERANCE):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.width, img.height
    tl, tr = px[0, 0], px[w - 1, 0]
    bg = tuple((tl[i] + tr[i]) // 2 for i in range(3))

    def is_bg(p):
        return all(abs(p[i] - bg[i]) <= tolerance for i in range(3))

    seen = bytearray(w * h)
    stack = [(x, 0) for x in range(w) if is_bg(px[x, 0])]
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))
    return img


def main():
    src = os.path.join(OUT, "ground.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs ground first")
    img = key_sky(Image.open(src))
    bbox = img.getbbox()
    img = img.crop((0, bbox[1], img.width, img.height))  # keep full width
    merge_manifest({"ground": save_sprite("ground", scale_to(img, w=320))})


if __name__ == "__main__":
    main()
