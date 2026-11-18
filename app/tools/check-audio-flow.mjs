// From app/: iwsdk browser run tools/check-audio-flow.mjs --timeout 90000
// Focused hands-only audio integration probe. No app-method/action calls or aircraft mutation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const execute = promisify(execFile);
export default async function run({ frame, workspaceRoot }) {
  const xr = async (action, input) => {
    const args = ['xr', action, '--raw'];
    if (input) args.push('--input-json', JSON.stringify(input));
    const { stdout } = await execute(join(workspaceRoot, 'node_modules/.bin/iwsdk'), args, { cwd: workspaceRoot, timeout: 15000 });
    const result = JSON.parse(stdout); if (result.ok === false || result.success === false) throw new Error(stdout);
    return result;
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const session = await xr('status'); if (!session.sessionActive) await xr('enter');
  await frame.evaluate(() => { (window.IWER_DEVICE ?? window.IWER_MCP.device).controlMode = 'programmatic'; });
  await xr('set-input-mode', { mode: 'hand' });
  await xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: -20, yaw: 0, roll: 0 } });
  await xr('set-transform', { device: 'hand-right', position: { x: 0.3, y: 1.1, z: 0.15 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  await frame.evaluate(async () => {
    const { observeLiveAudio } = await import('/tools/audio-live-probe.mjs');
    window.__audioFlowObserver = observeLiveAudio();
  });
  const snapshot = () => frame.evaluate(() => window.__audioFlowObserver.snapshot());
  const steps = [];
  const press = async (id, practice = false) => {
    await wait(550);
    const point = await frame.evaluate(({ id, practice }) => practice ? window.__trainer.controlPosition(id) : window.__trainer.targetPosition(id), { id, practice });
    await frame.evaluate(async (t) => {
      const d = window.IWER_DEVICE ?? window.IWER_MCP.device;
      d.controlMode = 'programmatic'; d.primaryInputMode = 'hand';
      const h = d.hands.right;
      h.setPinchValueImmediate(0); h.quaternion.set(0, 0, 0, 1);
      const n = [-t[0], 1.2 - t[1], -t[2]], length = Math.hypot(...n);
      n.forEach((v, i) => { n[i] = v / length; });
      const offset = [0.035, -0.045, 0];
      const from = t.map((v, i) => v + n[i] * 0.4 + offset[i]);
      const to = t.map((v, i) => v - n[i] * 0.1 + offset[i]);
      h.position.set(...from); await new Promise(resolve => setTimeout(resolve, 250));
      for (let i = 1; i <= 90; i++) { h.position.set(...from.map((v, k) => v + (to[k] - v) * i / 90)); await new Promise(resolve => setTimeout(resolve, 10)); }
      await new Promise(resolve => setTimeout(resolve, 120)); h.position.set(0.55, 0.6, 0.3);
    }, point);
    await wait(300); const state = await snapshot(); steps.push({ input: id, ...state }); return state;
  };
  const ambient = state => state.tracks.some(t => t.path === '/audio/sfx/ambient.mp3' && t.playing);
  try {
    let state = await snapshot();
    if (state.flow === 'welcome') state = await press('ui:continue');
    if (state.flow === 'modeSelect') state = await press('ui:auto');
    if (state.flow !== 'practice') throw new Error('Continue/Auto did not reach practice: ' + JSON.stringify(state));
    state = await press('practice.toggle', true);
    if (state.flow !== 'briefing' || ambient(state)) throw new Error('Practice/briefing failed: ' + JSON.stringify(state));
    state = await press('ui:begin');
    if (state.flow !== 'running' || !ambient(state)) throw new Error('Begin/ambience failed: ' + JSON.stringify(state));
    state = await press('kb:pause');
    await wait(500); const still = await snapshot();
    if (state.flow !== 'paused' || state.tracks.some(t => t.playing) || state.t !== still.t) throw new Error('Pause failed: ' + JSON.stringify(state));
    state = await press('ui:resume');
    if (state.flow !== 'running' || !ambient(state)) throw new Error('Resume failed: ' + JSON.stringify(state));
    await frame.evaluate(() => window.__audioFlowObserver.endXR()); await wait(300); const exited = await snapshot(); steps.push({ input: 'xr:exit', ...exited });
    if (exited.flow !== 'paused' || exited.tracks.some(t => t.playing)) throw new Error('XR exit pause failed: ' + JSON.stringify(exited));
    await xr('enter'); await xr('set-input-mode', { mode: 'hand' });
    await xr('set-transform', { device: 'hand-right', position: { x: 0.3, y: 1.1, z: 0.15 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
    state = await press('ui:resume');
    if (state.flow !== 'running' || !ambient(state)) throw new Error('XR re-entry resume failed: ' + JSON.stringify(state));
    if (!state.starts.some(s => s.path === '/audio/sfx/click.mp3') || !state.starts.some(s => s.path === '/audio/sfx/radioIn.mp3') || state.audioRequestsAfterPreload)
      throw new Error('Missing actual click/notification playback or unexpected request: ' + JSON.stringify(state));
    return { passed: true, steps, final: state };
  } finally {
    await frame.evaluate(() => { window.__audioFlowObserver?.dispose(); delete window.__audioFlowObserver; });
  }
}
