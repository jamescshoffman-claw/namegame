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


TRUNK_W = 26  # width the tiled trunk sprite is cut to


def trunk_span(img, y):
    """(min x, max x) of opaque pixels in row y."""
    px = img.load()
    xs = [x for x in range(img.width) if px[x, y][3] > 0]
    return (xs[0], xs[-1]) if xs else (0, img.width - 1)


def fit_base(base):
    """Scale the base so ITS trunk column matches the tiled trunk's width,
    then pad so that column is horizontally centered — the scene draws the
    base centered on the trunk line."""
    lo, hi = trunk_span(base, base.height // 20)  # a row near the top = pure trunk
    scale = TRUNK_W / (hi - lo + 1)
    base = scale_to(base, w=max(1, round(base.width * scale)))
    lo, hi = trunk_span(base, base.height // 20)
    mid = (lo + hi) // 2
    off = base.width // 2 - mid  # shift needed to center the trunk column
    out = Image.new("RGBA", (base.width + 2 * abs(off), base.height), (0, 0, 0, 0))
    out.alpha_composite(base, (max(0, 2 * off), 0))
    return out


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
        "trunk": save_sprite("trunk", scale_to(trunk, w=TRUNK_W)),
        "branch": save_sprite("branch", scale_to(branch, w=68)),
        "treebase": save_sprite("treebase", fit_base(base)),
        "leaf": save_sprite("leaf", scale_to(leaf, w=30)),
    }
    merge_manifest(entries)


if __name__ == "__main__":
    main()
