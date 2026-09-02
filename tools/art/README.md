# Art pipeline

Generated 16-bit art for NameGame, using the same OpenAI image workflow as
cloversaga's sprite tools. Raw generations land in `out/` (git-ignored);
cut scripts slice them into real game assets under `public/assets/`.

The game runs fine with zero generated assets — `scene.js` falls back to
built-in procedural pixel art for anything missing from
`public/assets/manifest.json`.

## Setup

Put the key in the repo root (git-ignored):

```
echo 'OPENAI_API_KEY=sk-...' > .env
python3 -m pip install pillow
```

## Generate + cut

```sh
# The squirrel (the only asset currently wired into the game)
node tools/art/gen-asset.mjs squirrel tools/art/prompts/squirrel.txt --transparent
python3 tools/art/cut-squirrel.py

# Style-locked follow-ups: pass the squirrel sheet as a reference so the
# whole set reads as one artist's work
node tools/art/gen-asset.mjs tree-tiles tools/art/prompts/tree-tiles.txt --ref tools/art/out/squirrel.png
node tools/art/gen-asset.mjs backdrops tools/art/prompts/backdrops.txt --ref tools/art/out/squirrel.png
```

Look at each generation before cutting — regenerate with a tweaked prompt if
poses are malformed or the grid is misaligned. Tree tiles and backdrops still
need cut scripts + scene wiring; the manifest format is
`{sprites: {name: {file, frames: [{x,y,w,h}]}}}`.
