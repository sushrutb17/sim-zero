// Writes public/THIRD-PARTY-NOTICES.md (served at /THIRD-PARTY-NOTICES.md) from the LICENSE files of the
// third-party packages that ship in the production bundle (Task 16).
//
// Usage (from app/): node tools/gen-third-party-notices.mjs
//
// SHIPPED was derived on 2026-11-14 from the production build's sourcemaps (every node_modules package that
// contributes code to dist/assets). Re-derive it when dependencies change: build with --sourcemap into a temp
// dir and list the node_modules/<pkg> prefixes of every .map file's `sources`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(app, 'node_modules');

const SHIPPED = [
  '@iwsdk/core', '@iwsdk/locomotor', '@iwsdk/scene-composition', '@iwsdk/xr-input',
  '@pmndrs/handle', '@pmndrs/pointer-events', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide',
  '@pmndrs/uikit-pub-sub', '@preact/signals-core', '@zappar/msdf-generator', 'comlink', 'elics', 'entities',
  'three', 'three-mesh-bvh', 'yoga-layout', 'zod',
];

const pkg = (name) => JSON.parse(readFileSync(join(nm, name, 'package.json'), 'utf8'));
const licenseText = (name) => readFileSync(join(nm, name, 'LICENSE'), 'utf8').trim();

/** yoga-layout's npm package has no LICENSE file; its package.json says MIT (Meta Open Source). */
const YOGA_MIT = `MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** Upstream licence of the Lucide icon set that @pmndrs/uikit-lucide packages (two icons ship: check, chevron-down). */
const LUCIDE_ISC = `ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** Only Inter ships (inter-*.js); keep its notice and the OFL text, not the other fonts msdfonts lists. */
function interNotice() {
  const t = readFileSync(join(nm, '@pmndrs/msdfonts/LICENSE'), 'utf8');
  const head = t.slice(t.indexOf('Inter:'), t.indexOf('\n\n', t.indexOf('Inter:'))).trim();
  const ofl = t.slice(t.indexOf('The above Font Software is licensed under the SIL Open Font License')).trim();
  return `${head}\n\n${ofl}`;
}

const out = [
  '# Third-party notices',
  '',
  'This trainer is original work. It ships the third-party software and font below; each is used under the licence reproduced here.',
  '',
];
for (const name of SHIPPED) {
  const j = pkg(name);
  out.push(`## ${name} ${j.version}`, '', `Licence: ${j.license?.startsWith('SEE LICENSE') ? 'MIT' : j.license}`, '');
  out.push('```text', name === 'yoga-layout' ? YOGA_MIT : licenseText(name), '```', '');
  if (name === '@pmndrs/uikit-lucide') out.push('Icon set (upstream Lucide):', '', '```text', LUCIDE_ISC, '```', '');
}
const uik = pkg('@drawcall/uikitml');
out.push(
  `## @drawcall/uikitml ${uik.version}`, '',
  'Included as a dependency of @iwsdk/core 1.0.1 (UIKitML markup loader). No licence is published in the npm package or in its public repository (https://github.com/drawcall-ai/uikitml), checked 2026-11-14.', '',
  '## Font: Inter (via @pmndrs/msdfonts ' + pkg('@pmndrs/msdfonts').version + ')', '',
  '```text', interNotice(), '```', '',
  '## Voice clips: generated with Kokoro-82M', '',
  'The radio, cabin, dispatch and first-officer voice clips (public/audio/voice/*.mp3) were generated offline with the Kokoro-82M text-to-speech model (weights by hexgrad, https://huggingface.co/hexgrad/Kokoro-82M), run through kokoro-onnx (MIT, developer tool, not shipped). The model weights are licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). The clips are computer-generated speech; no recording of a real person was used.', '',
);
writeFileSync(join(app, 'public/THIRD-PARTY-NOTICES.md'), out.join('\n'));
console.log(`wrote public/THIRD-PARTY-NOTICES.md (${SHIPPED.length + 3} entries)`);
