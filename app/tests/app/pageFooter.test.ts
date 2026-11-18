// T40: the 2D footer shows the build stamp only: no speech-recognition readout, no ?voicetest=1 button.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBuildStamp } from '../../src/app/buildInfo';
import { installPageFooter } from '../../src/app/pageFooter';

interface FakeEl {
  id: string;
  textContent: string;
  style: { cssText: string };
  children: FakeEl[];
  append(...c: FakeEl[]): void;
}
const el = (): FakeEl => ({ id: '', textContent: '', style: { cssText: '' }, children: [], append(...c) { this.children.push(...c); } });

describe('installPageFooter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds one footer with the build stamp and nothing else, even with ?voicetest=1 and a recognition API present', () => {
    const body = el();
    const created: FakeEl[] = [];
    vi.stubGlobal('location', { search: '?voicetest=1' });
    vi.stubGlobal('window', { SpeechRecognition: class {} });
    vi.stubGlobal('document', {
      getElementById: (id: string) => body.children.find((c) => c.id === id) ?? null,
      createElement: () => { const e = el(); created.push(e); return e; },
      body,
    });
    installPageFooter();
    installPageFooter(); // idempotent
    expect(body.children).toHaveLength(1);
    const footer = body.children[0];
    expect(footer.id).toBe('build-footer');
    expect(footer.textContent).toBe(formatBuildStamp());
    expect(footer.children).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(footer.textContent).not.toMatch(/voice|recognition/i);
  });
});
