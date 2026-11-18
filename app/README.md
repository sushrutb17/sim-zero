# Sim Zero app (IWSDK)

WebXR app built with Meta's Immersive Web SDK 1.0.1. `iwsdk.config.json` is the project authority
(scene, assets module, components module, XR features); systems are registered in `src/index.ts`.
See the repository [README](../README.md) for what Sim Zero is.

```sh
npm install
npm run dev          # CLI-managed dev server + IWER emulator (https://localhost:8081)
npm run typecheck
npm test             # vitest, headless (engine, contracts, pure UI models)
npm run build        # production build into dist/
npm run export:review   # regenerates ../docs/review/single-source-review.md from the scenario
node tools/gen-label-panels.mjs   # regenerates public/ui/*-labels.uikitml from the layout
```

## Layout

- `src/contracts/`, `src/bus/` - shared contracts (events, scenario schema, remote messages, event bus).
- `src/engine/` - headless scenario engine, grading and session (no rendering imports).
- `src/scenarios/` - scenario content only (Single Source and its variations, Time Critical, Cross-Check).
- `src/xr/` - cockpit shell and controls, displays, pedestal/kneeboard panels, outside view, `theme.ts` tokens.
- `tests/` - unit tests mirroring `src/`.

Dev-only views: `?demo=displays` and `?demo=panels` (not in production builds).
