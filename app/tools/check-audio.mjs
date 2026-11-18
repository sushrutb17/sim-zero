// From app/: npx @iwsdk/cli browser run tools/check-audio.mjs
// Requires a managed runtime with --headless --allow-browser-automation.
export default async function run({ frame, page }) {
  await frame.evaluate(async () => {
    const { prepareAudioSmoke } = await import('/tools/audio-smoke.mjs');
    window.__audioPreparationSmoke = prepareAudioSmoke();
  });
  const button = frame.getByRole('button', { name: 'Run isolated audio check' });
  await button.waitFor({ state: 'visible', timeout: 15000 });
  const audioRequests = [];
  const requested = request => { if (request.url().includes('/audio/')) audioRequests.push(request.url()); };
  page.on('request', requested);
  try {
    await button.click();
    const result = await frame.evaluate(() => window.__audioPreparationSmoke);
    result.audioRequestsAfterPreload = audioRequests.length;
    if (result.context !== 'running' || !result.started || !result.paused || !result.resumed || !result.reset || !result.queueDrained || result.errors.length || audioRequests.length)
      throw new Error(JSON.stringify(result));
    return result;
  } finally {
    page.off('request', requested);
    await frame.evaluate(() => { delete window.__audioPreparationSmoke; });
  }
}
