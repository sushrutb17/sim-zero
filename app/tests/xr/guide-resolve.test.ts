import { describe, expect, it } from 'vitest';
import { MAX_FRAMES, padNamesFor, padNamesForAll, type GuidePanels } from '../../src/xr/guide/resolve';
import type { AircraftState } from '../../src/contracts/aircraft';
import type { ActionMatch } from '../../src/contracts/scenario';

const state = (over: { hdg?: number; alt?: number; baro?: number } = {}): AircraftState =>
  ({ ap: { hdg: over.hdg ?? 0, alt: over.alt ?? 0, engaged: false, lateral: 'hdg', vertical: 'hold' }, baroHpa: over.baro ?? 1013 }) as unknown as AircraftState;

interface FakeOpts {
  cards?: { messageId: string; cardId: string; page: number; slot: number }[];
  current?: number;
  items?: Record<string, { page: number; slot: number }>;
  checkPage?: number;
}
const panels = (o: FakeOpts = {}): GuidePanels => ({
  comms: {
    pendingCards: () => (o.cards ?? []).map((c) => ({ messageId: c.messageId, cardId: c.cardId })),
    placementOf: (cardId, messageId) => {
      const c = (o.cards ?? []).find((x) => x.cardId === cardId && (messageId === undefined || x.messageId === messageId));
      return c ? { page: c.page, slot: c.slot } : undefined;
    },
    currentPage: () => o.current ?? 0,
    pagePadName: (page) => `pad:comms.page.${page}`,
  },
  checklist: { rowOf: (id) => o.items?.[id], pageIndex: () => o.checkPage ?? 0 },
});

const ctl = (controlId: string, value?: number | boolean | string): ActionMatch => ({ kind: 'control', controlId, value }) as ActionMatch;
const names = (t: ActionMatch, s = state(), p = panels()) => padNamesFor(t, s, p);

describe('guide resolver: steppers', () => {
  it('baro', () => {
    expect(names(ctl('baro.set', 1004), state({ baro: 1009 }))).toEqual(['pad:baro.set:minus']);
    expect(names(ctl('baro.set', 1004), state({ baro: 1000 }))).toEqual(['pad:baro.set:plus']);
    expect(names(ctl('baro.set', 1004), state({ baro: 1004 }))).toEqual([]);
  });
  it('hdg takes the short way and overshoots back', () => {
    const f = (from: number, to: number) => names(ctl('ap.hdg', to), state({ hdg: from }));
    expect(f(0, 90)).toEqual(['pad:ap.hdg:plus']);
    expect(f(90, 60)).toEqual(['pad:ap.hdg:minus']);
    expect(f(350, 10)).toEqual(['pad:ap.hdg:plus']);
    expect(f(10, 350)).toEqual(['pad:ap.hdg:minus']);
    expect(f(100, 90)).toEqual(['pad:ap.hdg:minus']);
    expect(f(0, 180)).toEqual(['pad:ap.hdg:plus']);
    expect(f(90, 90)).toEqual([]);
  });
  it('alt', () => {
    expect(names(ctl('ap.alt', 12000), state({ alt: 4000 }))).toEqual(['pad:ap.alt:plus']);
    expect(names(ctl('ap.alt', 12000), state({ alt: 13000 }))).toEqual(['pad:ap.alt:minus']);
  });
});

describe('guide resolver: other targets', () => {
  it('maps controls by id and value', () => {
    expect(names(ctl('ap.vertical', 'climb'))).toEqual(['pad:ap.vertical:climb']);
    expect(names(ctl('lights.landing', true))).toEqual(['pad:lights.landing']);
    expect(names(ctl('route.destination', 'alt1'))).toEqual(['pad:route.alt1']);
    expect(names(ctl('pa.cabin', true))).toEqual(['pad:pa.cabin']);
    expect(names({ kind: 'alertAck' })).toEqual(['pad:alerts.ack']);
    expect(names({ kind: 'hint' })).toEqual([]);
  });

  const cards = [
    { messageId: 'm1', cardId: 'a', page: 0, slot: 1 },
    { messageId: 'm2', cardId: 'a', page: 2, slot: 0 },
    { messageId: 'm2', cardId: 'b', page: 2, slot: 1 },
  ];
  it('reply card on the current page gives its card pad, else the page pad', () => {
    expect(names({ kind: 'reply', messageId: 'm1', cardId: 'a' }, state(), panels({ cards, current: 0 }))).toEqual(['pad:comms.card.1']);
    expect(names({ kind: 'reply', messageId: 'm1', cardId: 'a' }, state(), panels({ cards, current: 1 }))).toEqual(['pad:comms.page.0']);
  });
  it('reply with only cardId finds the card on whichever message offers it', () => {
    expect(names({ kind: 'reply', cardId: 'b' }, state(), panels({ cards, current: 2 }))).toEqual(['pad:comms.card.1']);
  });
  it('reply with only messageId gives one pad per card', () => {
    expect(names({ kind: 'reply', messageId: 'm2' }, state(), panels({ cards, current: 2 }))).toEqual(['pad:comms.card.0', 'pad:comms.card.1']);
  });
  it('a card that is not pending gives no pad', () => {
    expect(names({ kind: 'reply', cardId: 'zzz' }, state(), panels({ cards }))).toEqual([]);
  });

  const items = { i0: { page: 0, slot: 2 }, i1: { page: 1, slot: 0 } };
  it('checklist items by page', () => {
    const t = (id: string, checkPage: number) => names({ kind: 'checklistItem', checklistId: 'c', itemId: id }, state(), panels({ items, checkPage }));
    expect(t('i0', 0)).toEqual(['pad:check.row.2']);
    expect(t('i1', 0)).toEqual(['pad:check.next']);
    expect(t('i0', 1)).toEqual(['pad:check.prev']);
    expect(t('nope', 0)).toEqual([]);
  });
});

describe('padNamesForAll', () => {
  it('de-duplicates and caps at MAX_FRAMES', () => {
    const many = ['lights.landing', 'lights.strobe', 'elec.gen1', 'elec.gen2', 'elec.busTie'].map((c) => ctl(c, true));
    expect(MAX_FRAMES).toBe(4);
    expect(padNamesForAll(many, state(), panels())).toHaveLength(4);
    expect(padNamesForAll([ctl('lights.landing', true), ctl('lights.landing', true)], state(), panels())).toEqual(['pad:lights.landing']);
  });
});
