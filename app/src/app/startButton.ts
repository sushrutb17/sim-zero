/**
 * The 2D page's Start screen (T49). With `offer: "always"` the browser draws its own Enter VR button, which gives the page
 * no user activation, so the shared AudioContext stays suspended and the app is silent. This button is a real page click:
 * the caller's `onStart` runs synchronously inside it (resume audio, then launch XR). DOM only; colours follow
 * src/xr/theme.ts and the loading screen in index.html (bg #04060A, text #F4E3C3, textDim #BDB198, accent #A08CFF).
 *
 * Visible only when the app is ready (welcome screen drawn) and no immersive session is presenting.
 */
export interface StartButton {
  /** The app has loaded: the screen may show (unless a session is presenting). */
  setReady(): void;
  /** An immersive session started (true) or ended (false). */
  setPresenting(presenting: boolean): void;
}

export const START_LABEL = 'Start Sim Zero';
export const START_SUBLINE = 'Tap to start, with sound';
const NOTICE = 'Generic fictional aircraft for scenario-management practice only. These are not real or approved procedures.';

const CSS = `
#start-screen{position:fixed;inset:0;z-index:2147483000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:1.4rem;box-sizing:border-box;padding:1.5rem;background:#04060a;color:#f4e3c3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center}
#start-screen h1{margin:0;font-size:clamp(1.75rem,7vw,3rem);font-weight:600;letter-spacing:.02em}
#start-screen .notice{margin:0;max-width:34rem;font-size:clamp(1rem,3.6vw,1.25rem);line-height:1.5;color:#bdb198}
#start-screen button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem;box-sizing:border-box;width:min(24rem,88vw);min-height:6rem;padding:1rem 1.5rem;border:.2rem solid transparent;border-radius:1rem;background:#a08cff;color:#04060a;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
#start-screen button:hover{border-color:#f4e3c3}
#start-screen button:active{background:#8672e6}
#start-screen button:focus-visible{outline:.25rem solid #f4e3c3;outline-offset:.25rem}
#start-screen .label{font-size:clamp(1.6rem,6vw,2.2rem);font-weight:700;line-height:1.2}
#start-screen .sub{font-size:clamp(1rem,3.6vw,1.3rem);font-weight:500;line-height:1.3}
`;

export interface StartButtonOptions {
  /** Runs synchronously inside the click. */
  onStart(): void;
  /** False when the browser has no WebXR: the screen never shows, and the page stays as it was. */
  available?: boolean;
}

export function installStartButton(opts: StartButtonOptions): StartButton {
  let ready = false;
  let presenting = false;
  if (typeof document === 'undefined') return { setReady() {}, setPresenting() {} };
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.id = 'start-screen';
  const title = document.createElement('h1');
  title.textContent = 'Sim Zero';
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.textContent = NOTICE;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'start-button';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = START_LABEL;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = START_SUBLINE;
  button.append(label, sub);
  root.append(title, notice, button);
  button.addEventListener('click', () => {
    try { opts.onStart(); } catch (e) { console.error('Start failed:', e); }
  });
  const sync = () => { root.style.display = ready && !presenting && opts.available !== false ? 'flex' : 'none'; };
  sync();
  document.head.append(style);
  document.body.append(root);
  return {
    setReady() { ready = true; sync(); },
    setPresenting(p) { presenting = p; sync(); },
  };
}
