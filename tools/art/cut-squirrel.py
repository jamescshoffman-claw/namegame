#!/usr/bin/env python3
"""Slice the generated squirrel sheet into game frames.

Reads tools/art/out/squirrel.png (a 2x2 grid from gen-asset.mjs, ideally
generated with --transparent), trims each quadrant to its content, downscales
to true 32x32 pixel frames with nearest-neighbor, and writes:

  public/assets/squirrel.png     4 frames in a row: sit, leap, crouch, land
  public/assets/manifest.json    merged sprite entry the game loads

The game uses frame 0 (sit) and frame 1 (leap); the rest are spares.
Requires Pillow:  python3 -m pip install pillow
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SRC = os.path.join(ROOT, "tools", "art", "out", "squirrel.png")
ASSETS = os.path.join(ROOT, "public", "assets")
FRAME = 32
# grid order in the prompt: sit, leap / crouch, land — keep sit and leap first
CELLS = [(0, 0), (1, 0), (0, 1), (1, 1)]

WHITE_THRESHOLD = 245  # if the sheet has no alpha, near-white becomes clear


def to_alpha(img):
    img = img.convert("RGBA")
    if img.getextrema()[3][0] < 255:
        return img  # already has real transparency
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD:
                px[x, y] = (0, 0, 0, 0)
    return img


def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC} — run gen-asset.mjs squirrel first")
    sheet = to_alpha(Image.open(SRC))
    cw, ch = sheet.width // 2, sheet.height // 2

    out = Image.new("RGBA", (FRAME * len(CELLS), FRAME), (0, 0, 0, 0))
    for i, (cx, cy) in enumerate(CELLS):
        cell = sheet.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
        bbox = cell.getbbox()
        if not bbox:
            sys.exit(f"cell {i} is empty — regenerate the sheet")
        cell = cell.crop(bbox)
        scale = (FRAME - 2) / max(cell.width, cell.height)
        w, h = max(1, round(cell.width * scale)), max(1, round(cell.height * scale))
        cell = cell.resize((w, h), Image.NEAREST)
        out.alpha_composite(cell, (i * FRAME + (FRAME - w) // 2, FRAME - h))

    os.makedirs(ASSETS, exist_ok=True)
    out.save(os.path.join(ASSETS, "squirrel.png"))

    manifest_path = os.path.join(ASSETS, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    manifest.setdefault("sprites", {})["squirrel"] = {
        "file": "squirrel.png",
        "frames": [{"x": i * FRAME, "y": 0, "w": FRAME, "h": FRAME} for i in range(len(CELLS))],
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote {ASSETS}/squirrel.png and updated manifest.json")


if __name__ == "__main__":
    main()
