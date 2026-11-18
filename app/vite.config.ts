/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Commit the bundle was built from: Vercel's build variable, else the local checkout, else 'local'. */
function buildCommit(): string {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromHost) return fromHost.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'local';
  } catch {
    return 'local';
  }
}

export default defineConfig({
  plugins: [iwsdkDev()],
  // Build stamp shown on the welcome screen and the 2D page (src/app/buildInfo.ts): when this bundle was built and
  // from which commit, so a tester can tell which version a headset is showing. Under `vite` (dev) the time is the
  // server start.
  define: { __BUILD_INFO__: JSON.stringify({ time: new Date().toISOString(), commit: buildCommit() }) },
  // IWSDK_DEV_PORT lets parallel worktrees run their own dev server (default 8081).
  server: { host: '0.0.0.0', port: Number(process.env.IWSDK_DEV_PORT ?? 8081), open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    // Cold start (T16): @drawcall/uikitml (IWSDK's UIKitML loader) does `import * as Lucide` and registers every
    // export as a markup tag, so all ~1,600 icons (63% of the 6.7 MB main chunk) shipped although our .uikitml
    // files use only plain <div>s. The bare import now resolves to the two icons uikit-horizon imports itself
    // (CheckIcon, ChevronDownIcon). A lucide tag used in markup later must be added to src/vendor/lucide-subset.ts.
    alias: [{ find: /^@pmndrs\/uikit-lucide$/, replacement: fileURLToPath(new URL('./src/vendor/lucide-subset.ts', import.meta.url)) }],
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  // Worktrees symlink one shared node_modules; VITE_CACHE_DIR keeps a worktree's pre-bundled deps out of the shared
  // node_modules/.vite so its dev server cannot re-optimize deps under another worktree's running server. Keep it
  // inside node_modules (e.g. VITE_CACHE_DIR=node_modules/.vite-t16): pre-bundled deps keep bare imports such as
  // @zappar/msdf-generator, which fail to resolve from a cache outside the project.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  publicDir: 'public',
  base: './',
});
