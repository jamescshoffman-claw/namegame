// Generate an art sheet with the OpenAI image API (adapted from cloversaga's
// sprite pipeline). Writes raw generations to tools/art/out/ for the cut
// scripts to slice into game assets.
//
//   node tools/art/gen-asset.mjs <name> <prompt-file-or-text> [size] [--ref a.png,b.png]
//
//   <name>    the output: tools/art/out/<name>.png
//   <prompt>  a path to a .txt file, or the prompt itself in quotes
//   [size]    1024x1024 (default), 1536x1024, 1024x1536
//   --ref     comma-separated image paths sent as REFERENCES via the edits
//             endpoint — the model draws in the style of what it is shown.
//             Pass earlier sheets here so every asset stays one style.
//
// The key comes from OPENAI_API_KEY, or from `OPENAI_API_KEY=...` in the
// git-ignored .env at the repo root.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('no OPENAI_API_KEY in the environment or .env');
  process.exit(1);
}

const argv = process.argv.slice(2);
const refIdx = argv.indexOf('--ref');
const refs = refIdx >= 0 ? argv.splice(refIdx, 2)[1].split(',') : [];
const tIdx = argv.indexOf('--transparent');
const transparent = tIdx >= 0 && !!argv.splice(tIdx, 1);
const [name, promptArg, size = '1024x1024'] = argv;
if (!name || !promptArg) {
  console.error('usage: node tools/art/gen-asset.mjs <name> <prompt-file-or-text> [size] [--ref a.png,b.png]');
  process.exit(1);
}
const prompt = existsSync(promptArg) ? readFileSync(promptArg, 'utf8') : promptArg;

let res;
if (refs.length) {
  console.log('generating ' + name + '.png at ' + size + ' with ' + refs.length + ' reference image(s)...');
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', 'high');
  for (const r of refs) {
    const p = existsSync(r) ? r : join(root, r);
    form.append('image[]', new Blob([readFileSync(p)], { type: 'image/png' }), r.split(/[\\/]/).pop());
  }
  res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey() },
    body: form,
  });
} else {
  console.log('generating ' + name + '.png at ' + size + ' (' + prompt.length + ' chars of prompt)...');
  res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt, size, quality: 'high', n: 1,
      ...(transparent ? { background: 'transparent' } : {}),
    }),
  });
}
const body = await res.json();
if (!res.ok) {
  console.error('API error ' + res.status + ': ' + JSON.stringify(body.error || body).slice(0, 400));
  process.exit(1);
}
const outDir = join(root, 'tools', 'art', 'out');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, name + '.png');
writeFileSync(out, Buffer.from(body.data[0].b64_json, 'base64'));
console.log('wrote ' + out);
