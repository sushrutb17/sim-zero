import { AssetManager, AudioListener } from '@iwsdk/core';
import { audioAssetId } from '../src/xr/audioAssets';
import { THEME } from '../src/xr/theme';

/** Observe real browser audio; the driver uses only managed hand transforms/pinch input. */
export function observeLiveAudio() {
  const world = AssetManager.world;
  let listener;
  world.player.head.traverse(node => { if (node instanceof AudioListener) listener = node; });
  if (!listener) throw new Error('Shared AudioListener not found.');
  const context = listener.context;
  const buffers = new Map(Object.values(THEME.sfx).map(token => [AssetManager.getAudio(audioAssetId(token.file)), token.file]));
  const originalCreate = context.createBufferSource;
  const starts = []; const requests = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.name.includes('/audio/')) requests.push(entry.name); });
  observer.observe({ type: 'resource' });
  context.createBufferSource = function () {
    const node = originalCreate.call(context); const start = node.start;
    node.start = function (...args) { starts.push({ path: buffers.get(node.buffer) ?? 'other', at: context.currentTime }); return start.apply(node, args); };
    return node;
  };
  return {
    async endXR() { await world.renderer.xr.getSession().end(); },
    snapshot() {
      const tracks = [];
      world.scene.traverse(node => { if (node.name.startsWith('trainer-audio:')) tracks.push({ path: node.name.slice('trainer-audio:'.length), playing: node.isPlaying, loop: node.loop }); });
      return { flow: window.__trainer.flow(), context: context.state, t: window.__trainer.session().status.tInSet, tracks, starts: [...starts], audioRequestsAfterPreload: requests.length };
    },
    dispose() { context.createBufferSource = originalCreate; observer.disconnect(); },
  };
}
