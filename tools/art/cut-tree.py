#!/usr/bin/env python3
"""Slice tools/art/out/tree-tiles.png (2x2: trunk, branch, base, leaves)
into public/assets/{trunk,branch,treebase,leaf}.png + manifest entries."""
import os

from PIL import Image

from cutlib import OUT, grid_cells, merge_manifest, save_sprite, scale_to, to_alpha


def fill_row_gaps(img):
    """Close keyed-through holes: any clear pixel with opaque pixels on both
    sides of its row takes the color to its left (the trunk must stay a
    solid column or the sky shows through it)."""
    px = img.load()
    for y in range(img.height):
        row = [px[x, y][3] > 0 for x in range(img.width)]
        if not any(row):
            continue
        lo, hi = row.index(True), len(row) - 1 - row[::-1].index(True)
        for x in range(lo + 1, hi):
            if px[x, y][3] == 0:
                px[x, y] = px[x - 1, y]


def main():
    src = os.path.join(OUT, "tree-tiles.png")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} — run gen-asset.mjs tree-tiles first")
    # bg and bark outline are both dark brown — key tightly so outlines survive
    sheet = to_alpha(Image.open(src), tolerance=16)
    trunk, branch, base, leaf = grid_cells(sheet, 2, 2)

    # trunk: shave the outlined caps so it tiles vertically without seams
    cap = max(2, trunk.height // 20)
    trunk = trunk.crop((0, cap, trunk.width, trunk.height - cap))
    fill_row_gaps(trunk)
    entries = {
        "trunk": save_sprite("trunk", scale_to(trunk, w=26)),
        "branch": save_sprite("branch", scale_to(branch, w=68)),
        "treebase": save_sprite("treebase", scale_to(base, w=96)),
        "leaf": save_sprite("leaf", scale_to(leaf, w=30)),
    }
    merge_manifest(entries)


if __name__ == "__main__":
    main()
