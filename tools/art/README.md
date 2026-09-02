# Art pipeline

Generated 16-bit art for NameGame, using the same OpenAI image workflow as
cloversaga's sprite tools. Raw generations land in `out/` (git-ignored);
cut scripts slice them into real game assets under `public/assets/`.

The game runs fine with zero generated assets — `scene.js` falls back to
built-in procedural pixel art for anything missing from
`public/assets/manifest.json`. The committed assets cover the full scene:
squirrel, trunk/branch/treebase tiles, ground strip, and all sky elements
(sun, clouds, moon, star, three planets, galaxy). Night darkening is done
at runtime (`tintCanvas` in scene.js), so each sprite has a single daytime
version.

## Setup

Put the key in the repo root (git-ignored):

```
echo 'OPENAI_API_KEY=sk-...' > .env
python3 -m pip install pillow
```

## Generate + cut

```sh
# The squirrel first — it anchors the style
node tools/art/gen-asset.mjs squirrel tools/art/prompts/squirrel.txt --transparent
python tools/art/cut-squirrel.py

# Style-locked follow-ups: pass the squirrel sheet as a reference so the
# whole set reads as one artist's work
node tools/art/gen-asset.mjs tree-tiles tools/art/prompts/tree-tiles.txt 1024x1024 --ref tools/art/out/squirrel.png
python tools/art/cut-tree.py

node tools/art/gen-asset.mjs backdrops tools/art/prompts/backdrops.txt 1024x1024 --ref tools/art/out/squirrel.png
python tools/art/cut-backdrops.py

node tools/art/gen-asset.mjs ground tools/art/prompts/ground.txt 1536x1024 --ref tools/art/out/squirrel.png
python tools/art/cut-ground.py
```

Look at each generation before cutting — regenerate with a tweaked prompt if
poses are malformed or the grid is misaligned. `--transparent` is a request,
not a guarantee: the cut scripts flood-fill-key the flat background from the
image edges (`cutlib.to_alpha`), so opaque generations still slice cleanly.
For the tree sheet the background and the bark outlines are both dark brown —
`cut-tree.py` keys with a tighter tolerance so the outlines survive.

Manifest format: `{sprites: {name: {file, frames: [{x,y,w,h}]}}}`. Scene
anchors that matter if you regenerate:

- `branch.png`: the wood beam's top edge is assumed at row 23 (`drawTree`).
- `ground.png`: the solid grass line is assumed at row 16 (`drawGround`).

Re-measure and update scene.js if a regeneration shifts them.
