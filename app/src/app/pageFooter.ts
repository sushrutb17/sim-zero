/**
 * 2D page footer (T37): the build stamp, so a tester can tell which version the browser loaded before entering VR.
 * (T40 removed the temporary speech-recognition readout and the ?voicetest=1 button; voice replies are cut.)
 */
import { formatBuildStamp } from './buildInfo';

export function installPageFooter(): void {
  if (typeof document === 'undefined' || document.getElementById('build-footer')) return;
  const el = document.createElement('div');
  el.id = 'build-footer';
  // Above the loading screen (z-index 2147483000 in index.html), so the stamp shows while the app loads too.
  el.style.cssText =
    'position:fixed;left:0.75rem;bottom:0.6rem;z-index:2147483001;pointer-events:none;color:#bdb198;opacity:0.85;' +
    "font:500 0.8rem/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:left;max-width:calc(100vw - 1.5rem)";
  el.textContent = formatBuildStamp();
  document.body.append(el);
}
