# Asset and dependency ledger

Every third-party asset, dependency, generated asset or service. Licences were read from each package's own `package.json`/`LICENSE` on 2026-11-08 (`app/node_modules`). Competition content restrictions (no corporate logos, brand names, recognizable branded products, commercial artwork) apply **in addition** to licences.

## Code dependencies

| Asset/dependency | Version | Source URL | License | Used for | Ships to users? | Added |
| --- | --- | --- | --- | --- | --- | --- |
| `@iwsdk/core` | 1.0.1 | https://www.npmjs.com/package/@iwsdk/core | MIT | WebXR runtime, ECS, input, UI | Yes | 2026-11-08 |
| `@iwsdk/cli`, `@iwsdk/vite-plugin-dev`, `@iwsdk/reference` | 1.0.1 | https://www.npmjs.com/org/iwsdk | MIT | Dev server, emulator control, reference docs | No (dev) | 2026-11-08 |
| three (`super-three`) | 0.181.0 | https://www.npmjs.com/package/super-three | MIT | 3D rendering (via IWSDK) | Yes | 2026-11-08 |
| `@pmndrs/uikit`, `-horizon`, `-lucide` | 1.0.78 | https://github.com/pmndrs/uikit | MIT (text in LICENSE file) | Spatial UI panels, icons | Yes | 2026-11-08 | Since T16 (2026-11-14) only two lucide icons ship (check, chevron-down) via the `src/vendor/lucide-subset.ts` alias; upstream Lucide icon set is ISC.
| iwer / `@iwer/devui` | 2.8.0 | https://www.npmjs.com/package/iwer | MIT | XR emulator in dev/tests | No (dev) | 2026-11-08 |
| zod | 4.6.7 | https://www.npmjs.com/package/zod | MIT | Scenario schema validation | Yes | 2026-11-08 |
| `@drawcall/uikitml` | 0.1.8 | https://github.com/drawcall-ai/uikitml | **None published** (no `license` field, no LICENSE file in the npm package or the public repository; checked 2026-11-14; rechecked 2026-11-17: GitHub reports no licence, no LICENSE file, no licence field in any npm version) | UIKitML markup loader, a pinned dependency of `@iwsdk/core` 1.0.1; parses our label panels at runtime (its code is in the production bundle, verified 2026-11-17) | Yes (via IWSDK) | T16, 2026-11-14; **T53 decision (user, 2026-11-17): keep it and disclose it as part of Meta's SDK** (removal was offered and declined; the remaining risk is that the Sponsor asks for licence proof for this one dependency) |
| Transitive runtime packages: `@iwsdk/locomotor`, `-scene-composition`, `-xr-input` (MIT), `@pmndrs/handle`, `-pointer-events`, `-uikit-pub-sub` (MIT), `@preact/signals-core` (MIT), `@zappar/msdf-generator` (MIT), comlink (Apache-2.0), elics (MIT), entities (BSD-2-Clause), three-mesh-bvh (MIT), yoga-layout (MIT) | see `app/public/THIRD-PARTY-NOTICES.md` | npm | as listed | Pulled in by IWSDK/uikit; ship in the bundle (from production sourcemaps) | Yes | T16, 2026-11-14 |
| vite | 7.3.7 | https://www.npmjs.com/package/vite | MIT | Build | No (build) | 2026-11-08 |
| typescript | 5.9.3 | https://www.npmjs.com/package/typescript | Apache-2.0 | Language/typecheck | No (build) | 2026-11-08 |
| vitest | 5.1.0 | https://www.npmjs.com/package/vitest | MIT | Unit tests | No (dev) | 2026-11-08 |
| `@playwright/test` | 1.65.0 | https://www.npmjs.com/package/@playwright/test | Apache-2.0 | E2E tests | No (dev) | 2026-11-08 |
| `@meta-quest/metavr` | 1.10.0 | https://www.npmjs.com/package/@meta-quest/metavr | Meta Platform Technologies SDK License | Optional headset CLI (scaffold default). Collects usage data per its licence; may be uninstalled | No (dev) | scaffold, 2026-11-08 |

## Services

| Service | Plan | Used for | Notes |
| --- | --- | --- | --- |
| Vercel | Free (scope `sushrut17s-projects`) | Hosting https://vr-cockpit-trainer.vercel.app | Non-indexed until submission |
| GitHub | Private repo | Source control | `sushrutb17/vr-cockpit-trainer` |

## Media and 3D assets

| Asset | Source | License | Used for | Status |
| --- | --- | --- | --- | --- |
| Inter typeface (MSDF, weights light/medium/semi-bold/bold), bundled in `@pmndrs/msdfonts` 1.0.78 (dependency of `@pmndrs/uikit`) | https://github.com/rsms/inter via https://github.com/pmndrs/uikit (`app/node_modules/@pmndrs/msdfonts/LICENSE`) | SIL Open Font License 1.1 (verified in the package LICENSE file on 2026-11-08: "Copyright (c) 2016-2020 The Inter Project Authors"; package.json says "SEE LICENSE IN LICENSE") | All in-headset text (`THEME.text.fontUrl = 'builtin:inter'`, Task 7b). Ships unmodified inside the JS bundle; keep the OFL notice with the distribution (the package LICENSE travels with node_modules; add it to the release credits in Task 16). ASCII + ° glyphs only | In use (Task 7b) |
| Scaffold samples: `environment-desk`, `robot`, `plant-sansevieria` (glTF), `public/audio/chime.mp3`, `public/gltf/webxr-banner`, `public/textures/webxr.png`, `public/ui/welcome.uikitml` | IWSDK 1.0.1 starter template | Template sample content (licence not individually stated) | Nothing (starter demo) | **Removed in T08** (files deleted from the tree; nothing from the starter ships). Never reintroduce: unverified licence, and the WebXR banner is a logo |


## Original generated audio (T12 preparation, 2026-11-09)

All samples below are synthesized by original project code in `tools/gen-sfx.mjs`, without source recordings, sample libraries or manufacturer callouts. Project-owned generated assets; no third-party audio licence or attribution is required. They follow the generic sound palette, not a recorded cockpit. Prepared on `task/12-audio`; runtime integration/listening approval is pending.

| File in `app/public/audio/sfx/` | Source / rights | Use |
| --- | --- | --- |
| `click.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | Short physical-control contact feedback |
| `alertWarning.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | Three rising pips with a gap; warning loop until acknowledgement |
| `alertCaution.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | Single two-note caution |
| `chime.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | Cabin/incoming-message chime |
| `ambient.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | 24-second airflow/hum loop, with runtime voice ducking |
| `radioIn.mp3` | Original deterministic synthesis, `tools/gen-sfx.mjs` | Brief radio squelch texture |

Encoding tool: locally installed FFmpeg **8.1**, Homebrew build with `libmp3lame` (observed 2026-11-09), https://ffmpeg.org/; this build reports GPL version 3 or later (`ffmpeg -L`). Used as a development tool only; no FFmpeg binary/code ships. No voice service called and no TTS assets introduced in this preparation step.


## Generated voice clips (T12, 2026-11-14; T45, 2026-11-16; T44, 2026-11-17)

117 MP3 clips in `app/public/audio/voice/<messageId>.mp3` (62 ATC, 16 cabin, 17 dispatch, 22 first officer; 5,552,529 bytes and about 684 seconds in total), one per message id across the three flights and the twelve Single Source variations. 20 were added in T44 for Cross-Check, same model, voices and speeds. 37 are the Single Source baseline (T12, 1,644,225 bytes); 60 were added in T45 with the same model, voices and speeds (32 lines that differ in a Single Source variation, 28 Time Critical lines). All were generated **offline on the developer's Mac** by `tools/gen-voice.mjs` from the project's own original scenario text. Per-clip provenance (channel, content hash, input hash, model, voice, speed, time): `docs/review/voice-provenance.json`. The welcome notice says the voices are computer-generated.

| Asset / tool | Version | Source | License | Used for | Ships to users? |
| --- | --- | --- | --- | --- | --- |
| Kokoro-82M text-to-speech model (`kokoro-v1.0.onnx`, sha256 `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5`; `voices-v1.0.bin`, sha256 `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d`) | v1.0 (files from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0) | https://huggingface.co/hexgrad/Kokoro-82M | Apache-2.0 (model card: "This is an Apache-licensed model"; trained on permissive/non-copyrighted audio). Copyright the Kokoro authors (hexgrad); licence text https://www.apache.org/licenses/LICENSE-2.0 | Generating the voice clips. Voices: atc `am_michael` (speed 1.1), ground `am_fenrir` (1.1, unused), cabin `af_heart`, dispatch `bf_emma`, first officer `am_puck` | The model does not ship; only the generated MP3 clips do |
| `kokoro-onnx` | 0.6.1 | https://github.com/thewh1teagle/kokoro-onnx | MIT | Running the model (developer tool) | No |
| `onnxruntime`, `soundfile`, `phonemizer`, `espeakng-loader` (bundles espeak-ng) | 1.32.0 and the versions `uv` resolved on 2026-11-14 | PyPI | MIT / BSD-3-Clause / GPL-3.0 (phonemizer) / GPL-3.0 (espeak-ng) | Phonemes and inference on the developer machine | No (developer tool only; nothing of them is distributed) |
| Python 3.12 via `uv` | 3.12.13 | https://github.com/astral-sh/uv | MIT / Apache-2.0 (uv); PSF (Python) | Isolated environment in `tools/voice/.venv` (git-ignored) | No |
| FFmpeg | 8.1 (Homebrew) | https://ffmpeg.org/ | GPL-3.0-or-later (this build) | WAV to 64 kbps mono MP3 (developer tool) | No |

Pronunciation of radio numbers follows the project's own rules in `tools/voice-jobs.mjs` (`toSpoken`, INVENTED - VERIFY by the pilot reviewers). No online service was called and no scenario text left the machine. If `THIRD-PARTY-NOTICES.md` exists (T16), add the Kokoro Apache-2.0 notice there too.
