"""Shared helpers for slicing generated sheets into game assets."""
import json
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "tools", "art", "out")
ASSETS = os.path.join(ROOT, "public", "assets")

BG_TOLERANCE = 42


def to_alpha(img, tolerance=BG_TOLERANCE):
    """Key out the flat background by flood-filling from the image edges.

    Generations often come back opaque on a flat (not always white) field;
    flood fill only clears background connected to the border, so body
    colors that happen to be close to the background survive.
    """
    img = img.convert("RGBA")
    if img.getextrema()[3][0] < 255:
        return img  # already has real transparency
    px = img.load()
    w, h = img.width, img.height
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))

    def is_bg(p):
        return all(abs(p[i] - bg[i]) <= tolerance for i in range(3))

    seen = bytearray(w * h)
    stack = [(x, y) for x in range(w) for y in (0, h - 1) if is_bg(px[x, y])]
    stack += [(x, y) for y in range(h) for x in (0, w - 1) if is_bg(px[x, y])]
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


def grid_cells(img, cols, rows):
    """Yield each cell of a uniform grid, trimmed to its content."""
    cw, ch = img.width // cols, img.height // rows
    for cy in range(rows):
        for cx in range(cols):
            cell = img.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
            bbox = cell.getbbox()
            yield cell.crop(bbox) if bbox else None


def scale_to(img, w=None, h=None):
    """Nearest-neighbor scale to a target width or height, keeping aspect."""
    if w is not None:
        h2 = max(1, round(img.height * w / img.width))
        return img.resize((w, h2), Image.NEAREST)
    w2 = max(1, round(img.width * h / img.height))
    return img.resize((w2, h), Image.NEAREST)


def merge_manifest(entries):
    """Merge {name: {file, frames}} sprite entries into manifest.json."""
    os.makedirs(ASSETS, exist_ok=True)
    path = os.path.join(ASSETS, "manifest.json")
    manifest = {}
    if os.path.exists(path):
        with open(path) as f:
            manifest = json.load(f)
    manifest.setdefault("sprites", {}).update(entries)
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
    print("updated manifest.json with: " + ", ".join(entries))


def save_sprite(name, img):
    os.makedirs(ASSETS, exist_ok=True)
    img.save(os.path.join(ASSETS, name + ".png"))
    return {
        "file": name + ".png",
        "frames": [{"x": 0, "y": 0, "w": img.width, "h": img.height}],
    }
