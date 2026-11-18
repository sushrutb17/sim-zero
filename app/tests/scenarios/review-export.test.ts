// End-to-end CLI regression: the legacy review stays byte-identical while every registered flight gets a review.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FLIGHTS } from '../../src/scenarios/registry';
import { timeCritical } from '../../src/scenarios/time-critical';

it('exports one review per flight, preserves Single Source and marks all new invented procedures for pilot validation', () => {
  const appDir = fileURLToPath(new URL('../../', import.meta.url));
  const output = execFileSync(process.execPath, ['tools/export-review.mjs'], { cwd: appDir, encoding: 'utf8' });
  for (const f of FLIGHTS) {
    expect(output).toContain(`${f.id}-review.md`);
    expect(existsSync(new URL(`../../../docs/review/${f.id}-review.md`, import.meta.url))).toBe(true);
  }
  const baseline = readFileSync(new URL('../../../docs/review/single-source-review.md', import.meta.url));
  expect(createHash('sha256').update(baseline).digest('hex')).toBe('0a51c1622798b560b24cc782c9aff2f481352d7bb577de5776eccc76da8211de');
  const md = readFileSync(new URL('../../../docs/review/time-critical-review.md', import.meta.url), 'utf8');
  expect(md).toContain('app/src/scenarios/time-critical.ts');
  expect(md).toContain('autopilot engaged');
  expect(md).toContain('strobe on');
  expect(md).not.toContain('autopilot off');
  expect(md).not.toContain('Event Set 4');
  expect(md).not.toContain('GEN 1 OFF');
  expect(md).not.toContain('## Checklists (INVENTED - VERIFY)');
  expect(md).toContain('## Checklists (to be validated by the user (a pilot))');
  expect(md).not.toContain('8. **Guided flight steps.**');
  expect(md).toContain('Voices are computer-generated.');
  expect(md).not.toContain('no guided steps or generated voice clips');
  expect(md).toContain('Voice clips for this flight are generated at integration; until then the lines show as captions.');
  expect(md).not.toContain('finishing the cabin brief before completing them can end the exercise');
  const marker = 'to be validated by the user (a pilot)';
  expect(md).toContain(marker);
  for (const checklist of timeCritical.checklists) for (const item of checklist.items) {
    expect(md.split('\n').find(line => line.includes(item.text))).toContain(marker);
  }
  for (const es of timeCritical.eventSets) {
    expect(md).toContain(es.instructorNotes);
    expect(md).toContain(es.objective);
    for (const h of es.hints) expect(md).toContain(h);
    for (const c of [...es.startCues, ...es.rules.flatMap(r => r.cues)]) if (c.kind === 'message') {
      expect(md).toContain(c.text);
      expect(md.split('\n').find(line => line.includes(`message** \`${c.id}\``))).toContain(marker);
      for (const k of c.cards ?? []) expect(md).toContain(k.text);
    }
  }
}, 20000);
