# Sim Zero

**A seated VR cockpit trainer for rehearsing scenario management, used with your hands.**

Sim Zero is "the session before the first simulator session": a bridge between classroom theory and the simulator. You sit in a generic, fictional airliner cockpit and work through scripted flights with your hands. You press switches and buttons, read printouts on the kneeboard, answer ATC, the cabin and dispatch with reply cards, and run electronic checklists. At the end, a debrief grades each part of the flight with reasons and a timeline, and you can redo any part.

Built for the [Meta VR Start Developer Competition 2026](https://start-developer-competition-26.devpost.com/).

**Try it:** open **https://vr-cockpit-trainer.vercel.app** in the Meta Quest Browser, sit down, and press **Start Sim Zero**. Hands only; no controllers needed. Step-by-step guide (about ten minutes): **[HOW-TO-TRY.md](HOW-TO-TRY.md)**.

**Demo video:** https://youtu.be/-5ztBYdWSr4

> A rehearsal prototype, not certified training. The aircraft, airline, airports and every procedure are fictional and invented for this project. They are not real or approved procedures.

## What's in it

- **Three flights:**
  - **Single Source:** a generator fails over open water (twelve variations).
  - **Time Critical:** a passenger collapses in cruise.
  - **Cross-Check:** a late change and a busy frequency.
- **Two ways to fly:**
  - **GUIDED FLIGHT:** an instruction strip and a violet frame on the next control.
  - **PRACTISE ALONE.**
- **Debrief:** a grade and reasons for each part of the flight, a timeline of what arrived and when you answered, the electrical system before and after a failure, and REDO for any part.
- **Voiced:** every radio, cabin, dispatch and first-officer line has a computer-generated voice (generated offline, 117 clips) and is also shown as text.
- **Comfort:** seated, with an adjustable seat (0 to +50 cm), poke or point-and-pinch input, and pause, resume and restart at any time.

## Built with

WebXR and Meta's [Immersive Web SDK](https://iwsdk.dev/) (IWSDK 1.0.1) with Three.js and TypeScript. The app is in [`app/`](app/README.md): a headless scenario engine and grader, scenario content kept separate from the cockpit code, and the cockpit, panels and screens drawn in WebXR.

```sh
cd app
npm install
npm run dev        # dev server with the IWER desktop XR emulator (https://localhost:8081)
npm test           # unit tests (vitest)
npm run build      # production build into app/dist/
npx playwright test   # hands-only end-to-end runs in the emulator (about 15 minutes)
```

Voice clips and sound effects are generated offline by the scripts in [`tools/`](tools/): `gen-voice.mjs` (local text-to-speech; `tools/voice/setup.sh` installs it) and `gen-sfx.mjs`.

## Third-party code and assets

All third-party code, fonts and models, with their licences, are listed in [`app/public/THIRD-PARTY-NOTICES.md`](app/public/THIRD-PARTY-NOTICES.md) (served with the app) and [`docs/asset-ledger.md`](docs/asset-ledger.md). One dependency installed automatically by Meta's IWSDK, `@drawcall/uikitml`, has no published licence; it is used unmodified, through the SDK, as the notices explain.

## Licence

Copyright (c) 2026 sushrutb17. All rights reserved. See [LICENSE](LICENSE). The source is published so that it can be read; it is not licensed for reuse.
