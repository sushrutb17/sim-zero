// Loads every registered flight/variation, the baseline scenario and the theme through Vite SSR (no browser, no network).
// Shared by tools/export-audio.mjs and tools/gen-voice.mjs.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadScenario() {
  const appDir = join(root, 'app');
  const require = createRequire(import.meta.url);
  const { createServer } = await import(pathToFileURL(require.resolve('vite', { paths: [appDir] })).href);
  const server = await createServer({ configFile: false, root: appDir, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { singleSource } = await server.ssrLoadModule('/src/scenarios/single-source.ts');
    const { allScenarios } = await server.ssrLoadModule('/src/scenarios/registry.ts');
    const { THEME } = await server.ssrLoadModule('/src/xr/theme.ts');
    return { singleSource, allScenarios, THEME, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}
