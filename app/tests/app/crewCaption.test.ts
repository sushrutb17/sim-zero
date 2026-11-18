import { expect, it } from 'vitest';
import { CrewCaption } from '../../src/app/crewCaption';
const cue = (text = 'Crew line') => ({ kind: 'message' as const, channel: 'crew' as const, id: 'crew', text });
it('shows for six seconds and newer crew restarts the expiry', () => {
 const c = new CrewCaption(); c.apply(cue(), 10); expect(c.current(6009)).toBe('Crew line'); expect(c.current(6010)).toBeNull();
 c.apply(cue(), 7000); c.apply(cue('New'), 8000); expect(c.current(13999)).toBe('New'); expect(c.current(14000)).toBeNull();
});
it('ignores other channels and alerts and reset clears', () => {
 const c = new CrewCaption(); c.apply(cue(), 0);
 for (const channel of ['atc', 'cabin', 'dispatch', 'ground'] as const) c.apply({ ...cue(), channel }, 5000);
 c.apply({ kind: 'printout', id: 'p', title: 'Printout', body: 'Ignored' }, 5000);
 c.apply({ kind: 'alert', id: 'a', level: 'caution', text: 'Alert' }, 5000);
 expect(c.current(5999)).toBe('Crew line'); expect(c.current(6000)).toBeNull(); c.apply(cue(), 7000); c.reset(); expect(c.current(7001)).toBeNull();
});
