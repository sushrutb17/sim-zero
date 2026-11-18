import { beforeEach, describe, expect, it } from 'vitest';
import { PilotActionSchema, type PilotAction, type Stamped, type WorldCue } from '../../src/contracts/events';
import { singleSource } from '../../src/scenarios/single-source';
import { ScenarioEngine } from '../../src/engine/scenarioEngine';
import { gradeEventSet } from '../../src/engine/grading';
import { ChecklistModel, CommsModel, KneeboardModel, RouteModel, cardFamily, kneeboardPages } from '../../src/xr/panels/panelModel';
import { lineHeightM, packCards, wrapText } from '../../src/xr/panels/textLayout';
import { PRINTOUT_NOTE, layoutMessagePage, layoutRecent } from '../../src/xr/panels/cardLayout';
import { readFileSync } from 'node:fs';
import { inter } from '@pmndrs/msdfonts';
import { COMMS_MESSAGE_PAGES_MAX, MIN_GAP, commsGeo, kneeboardGeo } from '../../src/xr/cockpit/layout';
import { THEME, fontSizeForCap } from '../../src/xr/theme';

let seq = 0;
const stamp = (body: WorldCue): Stamped<WorldCue> => ({ t: seq, seq: ++seq, body });
const msg = (id: string, cards: string[] = [], text = `Message ${id}`): WorldCue => ({
  kind: 'message',
  id,
  channel: 'atc',
  text,
  cards: cards.length ? cards.map((c) => ({ id: c, text: `Card ${c}` })) : undefined,
});
const setStart = (eventSetId: string): WorldCue => ({ kind: 'eventSet', eventSetId, status: 'start' });
/** ~1 unit per character; good enough for pure layout tests. */
const measure = (s: string) => s.length;

describe('CommsModel', () => {
  let comms: CommsModel;
  beforeEach(() => {
    comms = new CommsModel();
  });

  it('cards cleared after choice', () => {
    comms.apply(stamp(setStart('es1')).body);
    comms.apply(msg('m1', ['a', 'b']));
    expect(comms.pendingCards().map((c) => c.cardId)).toEqual(['a', 'b']);
    const action = comms.choose('m1', 'b');
    expect(action).toEqual({ kind: 'reply', messageId: 'm1', cardId: 'b' });
    expect(PilotActionSchema.safeParse(action).success).toBe(true);
    expect(comms.pendingCards()).toEqual([]);
    expect(comms.choose('m1', 'a')).toBeNull(); // answered: no second action
  });

  it('cards persist for every unanswered message in the current set', () => {
    comms.apply(setStart('es4'));
    comms.apply(msg('m1', ['a1', 'a2']));
    comms.apply(msg('m2', ['b1']));
    comms.apply(msg('m3', ['c1', 'c2', 'c3']));
    // newest message first, cards of older unanswered messages still offered
    expect(comms.pendingCards().map((c) => c.cardId)).toEqual(['c1', 'c2', 'c3', 'b1', 'a1', 'a2']);
    // answering an OLDER message removes only that message's cards
    expect(comms.choose('m1', 'a2')).toEqual({ kind: 'reply', messageId: 'm1', cardId: 'a2' });
    expect(comms.pendingCards().map((c) => c.cardId)).toEqual(['c1', 'c2', 'c3', 'b1']);
    // a card must belong to its message
    expect(comms.choose('m2', 'c1')).toBeNull();
  });

  it('cards from a previous set are cleared on eventSet start', () => {
    comms.apply(setStart('es3'));
    comms.apply(msg('m1', ['a']));
    comms.apply(msg('m2', ['b']));
    comms.apply(setStart('es4'));
    expect(comms.pendingCards()).toEqual([]);
    expect(comms.lastMessages(3).map((m) => m.id)).toEqual(['m2', 'm1']); // text stays in the log
    comms.apply(msg('m3', ['c']));
    expect(comms.pendingCards().map((c) => c.cardId)).toEqual(['c']);
  });

  it('shows the last 3 messages newest first and re-sending an id replaces the old entry', () => {
    for (const id of ['m1', 'm2', 'm3', 'm4']) comms.apply(msg(id));
    expect(comms.lastMessages(3).map((m) => m.id)).toEqual(['m4', 'm3', 'm2']);
    comms.apply(msg('m2', ['x']));
    expect(comms.lastMessages(3).map((m) => m.id)).toEqual(['m2', 'm4', 'm3']);
    expect(comms.pendingCards().map((c) => c.cardId)).toEqual(['x']);
  });

  it('reset clears everything', () => {
    comms.apply(setStart('es1'));
    comms.apply(msg('m1', ['a']));
    comms.reset();
    expect(comms.pendingCards()).toEqual([]);
    expect(comms.lastMessages(3)).toEqual([]);
  });
});

describe('ChecklistModel', () => {
  it('checklistAvailable opens that checklist with the scenario title and items', () => {
    const cl = new ChecklistModel(singleSource.checklists);
    expect(cl.current()).toBeNull();
    cl.open('beforeTakeoff');
    const def = singleSource.checklists.find((c) => c.id === 'beforeTakeoff')!;
    expect(cl.current()?.title).toBe(def.title);
    expect(cl.current()?.items.map((i) => i.id)).toEqual(def.items.map((i) => i.id));
    expect(cl.open('nope')).toBe(false);
  });

  it('checklist records out-of-order item', () => {
    const cl = new ChecklistModel(singleSource.checklists);
    cl.open('beforeTakeoff');
    const ids = cl.current()!.items.map((i) => i.id);
    const third = cl.tick(ids[2])!;
    expect(third.action).toEqual({ kind: 'checklistItem', checklistId: 'beforeTakeoff', itemId: ids[2] });
    expect(PilotActionSchema.safeParse(third.action).success).toBe(true);
    expect(third.inOrder).toBe(false);
    expect(cl.isTicked(ids[2])).toBe(true);
    expect(cl.tick(ids[0])!.inOrder).toBe(true);
    expect(cl.tick(ids[1])!.inOrder).toBe(true);
    expect(cl.tickOrder()).toEqual([ids[2], ids[0], ids[1]]);
    expect(cl.outOfOrder()).toEqual([ids[2]]);
    expect(cl.tick(ids[2])).toBeNull(); // already confirmed: no duplicate action
  });

  it('keeps ticks per checklist and reset clears them', () => {
    const cl = new ChecklistModel(singleSource.checklists);
    cl.open('beforeTakeoff');
    const a = cl.current()!.items[0].id;
    cl.tick(a);
    cl.open('genFail');
    expect(cl.isTicked(a)).toBe(false);
    cl.open('beforeTakeoff');
    expect(cl.isTicked(a)).toBe(true);
    cl.reset();
    expect(cl.current()).toBeNull();
    cl.open('beforeTakeoff');
    expect(cl.isTicked(a)).toBe(false);
  });
});

describe('RouteModel', () => {
  it('lists every scenario airport by ASCII name, emits the id and syncs without emitting', () => {
    const r = new RouteModel(singleSource.airports, 'dest');
    expect(r.rows().map((x) => x.id)).toEqual(singleSource.airports.map((a) => a.id));
    for (const row of r.rows()) expect(row.name).toMatch(/^[\x20-\x7e]+$/);
    expect(r.selected()).toBe('dest');
    const act = r.select('alt1');
    expect(act).toEqual({ kind: 'control', controlId: 'route.destination', value: 'alt1' });
    expect(PilotActionSchema.safeParse(act).success).toBe(true);
    expect(r.selected()).toBe('alt1');
    r.setDestination('dep');
    expect(r.selected()).toBe('dep');
    expect(r.select('nope')).toBeNull();
  });
});

describe('KneeboardModel', () => {
  const make = () => new KneeboardModel(singleSource.briefing, singleSource.eventSets);
  const es1 = singleSource.eventSets[0];

  it('hint shows next unused hint and emits once', () => {
    const kb = make();
    const sent: PilotAction[] = [];
    expect(kb.pressHint()).toBeNull(); // no event set yet: nothing to ask about
    kb.onEventSet(es1.id);
    const first = kb.pressHint();
    expect(first).toEqual({ kind: 'hint', eventSetId: es1.id });
    sent.push(first!);
    expect(kb.hintText()).toBe(es1.hints[0]);
    const second = kb.pressHint();
    sent.push(second!);
    expect(kb.hintText()).toBe(es1.hints[1]);
    expect(sent).toHaveLength(2);
    expect(PilotActionSchema.safeParse(sent[0]).success).toBe(true);
    // hints exhausted: nothing more to emit, text says so
    expect(kb.pressHint()).toBeNull();
    expect(kb.hintText()).toMatch(/no more hints/i);
  });

  it('uses the latest eventSet start and clears the shown hint on a new set', () => {
    const kb = make();
    kb.onEventSet(es1.id);
    kb.pressHint();
    kb.onEventSet(singleSource.eventSets[1].id);
    expect(kb.hintText()).toBeNull();
    expect(kb.pressHint()).toEqual({ kind: 'hint', eventSetId: singleSource.eventSets[1].id });
  });

  it('pages: briefing entries first, then printouts as they arrive', () => {
    const kb = make();
    const wrap = (t: string) => wrapText(t, 30, measure);
    const before = kneeboardPages(kb.entries(), wrap, 9).map((p) => p.entryId);
    expect(before.filter((id, i, a) => a.indexOf(id) === i)).toEqual(singleSource.briefing.map((b) => b.id));
    kb.addPrintout('atis', 'ATIS', 'line one\nline two');
    const after = kneeboardPages(kb.entries(), wrap, 9);
    expect(after[after.length - 1].entryId).toBe('atis');
    expect(after[after.length - 1].title).toBe('ATIS');
    // a long body splits across numbered continuation pages
    const long = kneeboardPages([{ id: 'x', title: 'Long', body: Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') }], wrap, 3);
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((p) => p.lines.length <= 3)).toBe(true);
  });

  it('next and prev clamp, and a new printout opens its page', () => {
    const kb = make();
    expect(kb.pageIndex()).toBe(0);
    kb.prev();
    expect(kb.pageIndex()).toBe(0);
    kb.next();
    expect(kb.pageIndex()).toBe(1);
    kb.addPrintout('atis', 'ATIS', 'x');
    expect(kb.pages()[kb.pageIndex()].entryId).toBe('atis');
  });

  it('kneeboard render model contains no instructor fields', () => {
    const kb = make();
    kb.onEventSet(es1.id);
    kb.pressHint();
    kb.addPrintout('atis', 'ATIS', 'body');
    kb.setLayout((t) => wrapText(t, 30, measure), 9);
    const model = kb.renderModel();
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      else if (typeof v === 'string') {
        for (const es of singleSource.eventSets) expect(v).not.toContain(es.instructorNotes.slice(0, 40));
      }
    };
    walk(model);
    expect(keys.has('instructorNotes')).toBe(false);
    expect(keys.has('instructorLabel')).toBe(false);
    expect(keys.size).toBeGreaterThan(3);
  });
});

describe('text layout', () => {
  it('wraps on words, keeps paragraphs and hard-breaks over-long words', () => {
    expect(wrapText('aaa bbb ccc', 7, measure)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('one\ntwo three', 20, measure)).toEqual(['one', 'two three']);
    expect(wrapText('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 5, measure)).toEqual(['']);
  });

  it('packCards fills pages greedily without overflowing', () => {
    const pages = packCards([0.04, 0.04, 0.06, 0.04], 0.1, 0.012);
    expect(pages.map((p) => p.map((c) => c.index))).toEqual([[0, 1], [2], [3]]);
    expect(pages[0][1].y).toBeCloseTo(0.052);
    // a card taller than the area still gets its own page
    expect(packCards([0.2], 0.1, 0.012)).toHaveLength(1);
  });
});

/** Every message the real scenario can send, in cue order per event set (start cues, rule cues, soft-timeout prompt). */
function scenarioMessages(): Array<{ setId: string; cue: Extract<WorldCue, { kind: 'message' }> }> {
  const out: Array<{ setId: string; cue: Extract<WorldCue, { kind: 'message' }> }> = [];
  for (const es of singleSource.eventSets) {
    for (const c of [...es.startCues, ...es.rules.flatMap((r) => r.cues)]) if (c.kind === 'message') out.push({ setId: es.id, cue: c });
  }
  const prompt = singleSource.softTimeout?.promptCue;
  if (prompt && prompt.kind === 'message') out.push({ setId: singleSource.softTimeout!.eventSetId, cue: prompt });
  return out;
}

describe('reply-card family convention (real single-source content)', () => {
  // CommsModel.choose retires, on every other open message, the cards of the same FAMILY (id prefix before the first '-') as
  // a card it shares with the chosen message. Scenario content must keep this convention.
  const allCards = (): Array<{ where: string; id: string }> => {
    const out: Array<{ where: string; id: string }> = [];
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.kind === 'message' && Array.isArray(o.cards)) for (const c of o.cards as Array<{ id: string }>) out.push({ where: `message ${String(o.id)}`, id: c.id });
        for (const [k, x] of Object.entries(o)) walk(x, `${where}.${k}`);
      }
    };
    walk(singleSource, 'scenario');
    return out;
  };

  it('every reply-card id has a non-empty family prefix before its first "-"', () => {
    const cards = allCards();
    expect(cards.length).toBeGreaterThan(20); // the walk really found the scenario's cards (incl. the soft-timeout prompt)
    expect(cards.some((c) => c.where === 'message ctr-say-intentions')).toBe(true);
    // Known exception in the frozen scenario: dsp-concern's "reconsider" has no '-'. cardFamily treats it as a one-card
    // family (the whole id), shared by no other card. Do not add more: new ids must be "<family>-<name>".
    const HYPHENLESS_ALLOWED = new Set(['reconsider']);
    for (const c of cards) {
      expect(cardFamily(c.id).length, `Reply-card id "${c.id}" (${c.where}) has an empty family prefix (starts with '-'). See CommsModel.choose.`).toBeGreaterThan(0);
      const ok = c.id.includes('-') || HYPHENLESS_ALLOWED.has(c.id);
      expect(ok, `Reply-card id "${c.id}" (${c.where}) breaks the family convention: ids must be "<family>-<name>" (e.g. dec-return). See CommsModel.choose.`).toBe(true);
    }
    for (const id of HYPHENLESS_ALLOWED) {
      expect(cards.some((c) => c.id === id), `allowed hyphenless id "${id}" no longer exists; remove it from the exception list`).toBe(true);
      const others = cards.filter((c) => c.id !== id && cardFamily(c.id) === cardFamily(id)).map((c) => c.id);
      expect(others, `hyphenless id "${id}" must be a one-card family, but shares it with [${others.join(', ')}]`).toEqual([]);
    }
  });

  it('mutually exclusive choice sets resolve to single families (dec-* decision, dev-* deviation; dep-readback is not dev)', () => {
    const ids = new Set(allCards().map((c) => c.id));
    const sameFamily = (group: string[], label: string) => {
      for (const id of group) expect(ids.has(id), `${label}: card "${id}" no longer exists in the scenario; update this guard and the family convention`).toBe(true);
      const fams = [...new Set(group.map(cardFamily))];
      expect(fams, `${label} cards [${group.join(', ')}] must share ONE family prefix, got [${fams.join(', ')}]: choosing one would no longer retire the others on other open messages`).toHaveLength(1);
      return fams[0];
    };
    const dec = sameFamily(['dec-return', 'dec-divert-alt1', 'dec-divert-alt2', 'dec-continue'], 'Decision');
    const dev = sameFamily(['dev-left', 'dev-right'], 'Deviation');
    expect(dec, 'Decision and deviation families must differ').not.toBe(dev);
    expect(ids.has('dep-readback'), 'card "dep-readback" no longer exists; update this guard').toBe(true);
    expect(cardFamily('dep-readback'), `"dep-readback" must NOT be in the deviation family "${dev}": choosing a deviation on atc-wx would retire the climb readback on dep-climb`).not.toBe(dev);
    // no card outside these groups may share their families (it would be retired with them)
    for (const id of ids) {
      if (cardFamily(id) === dec) expect(id, `card "${id}" is in the decision family "${dec}" but is not a decision card`).toMatch(/^dec-(return|divert-alt1|divert-alt2|continue)$/);
      if (cardFamily(id) === dev) expect(id, `card "${id}" is in the deviation family "${dev}" but is not a deviation card`).toMatch(/^dev-(left|right)$/);
    }
  });
});

describe('comms pages (real single-source content)', () => {
  /**
   * Real Inter advance widths from the bundled MSDF font (the font the headset UI uses), medium for text and bold for tags,
   * plus 6% for the canvas font-fallback difference. The panel itself measures with its canvas context.
   */
  const bodyEm = fontSizeForCap(THEME.text.capM.body);
  const widthIn = (face: typeof inter.medium) => {
    const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
    return (t: string) => ([...t].reduce((a, ch) => a + (adv.get(ch) ?? adv.get('n')!), 0) / face.info.size) * bodyEm * 1.06;
  };
  const measure = widthIn(inter.medium);
  const boldWidth = widthIn(inter.bold);
  const tagWidth = (tag: string) => boldWidth(tag);
  const tagOf = (ch: string) => ({ atc: 'ATC', cabin: 'CABIN', dispatch: 'DISPATCH', ground: 'GROUND' })[ch] ?? ch.toUpperCase();
  const g = commsGeo();
  const area = { top: g.content.top, h: g.content.h, w: g.content.w };
  const cardsOf = (m: Extract<WorldCue, { kind: 'message' }>) => (m.cards ?? []).map((k) => ({ messageId: m.id, channel: m.channel, cardId: k.id, text: k.text }));

  it('EVERY scenario message with its own cards fits ONE page at body with zero truncation', () => {
    const all = scenarioMessages();
    expect(all.length).toBeGreaterThan(20);
    let withCards = 0;
    for (const { cue } of all) {
      const tag = tagOf(cue.channel);
      const lay = layoutMessagePage(cue.text, cardsOf(cue), measure, tagWidth(tag), area);
      expect(lay.fits, `${cue.id}: needs ${(lay.usedH * 1000).toFixed(0)} mm of ${(area.h * 1000).toFixed(0)} mm`).toBe(true);
      // zero truncation: the wrapped lines are exactly the message text (no ellipsis, nothing dropped)
      expect(lay.lines.join(' '), cue.id).toBe(cue.text);
      for (const l of lay.lines) expect(l).not.toContain('...');
      lay.cards.forEach((c, i) => {
        const src = cue.cards![i];
        expect(c.lines.join(' '), `${cue.id}/${src.id}`).toBe(src.text);
        expect(c.lines.join(' ')).not.toContain('...');
        expect(c.h, 'card hit height').toBeGreaterThanOrEqual(THEME.control.minHitM - 1e-9);
        expect(c.lines.length * lineHeightM('body'), 'card text fits its card').toBeLessThanOrEqual(c.h);
        expect(c.cy - c.h / 2, 'card inside the panel').toBeGreaterThanOrEqual(g.content.bottom - 1e-9);
        if (i > 0) expect(lay.cards[i - 1].cy - lay.cards[i - 1].h / 2 - (c.cy + c.h / 2), 'card gap').toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
      });
      if (cue.cards?.length) withCards++;
    }
    expect(withCards).toBeGreaterThan(10);
  });

  it('the ES4 decision page (dsp-concern) shows its full text and both cards on one page', () => {
    const concern = scenarioMessages().find((m) => m.cue.id === 'dsp-concern')!.cue;
    expect(concern.text.length).toBeGreaterThan(180);
    const lay = layoutMessagePage(concern.text, cardsOf(concern), measure, tagWidth('DISPATCH'), area);
    expect(lay.fits).toBe(true);
    expect(lay.cards).toHaveLength(2);
    expect(lay.lines.join(' ')).toBe(concern.text);
  });

  it('cards of one message are never split across pages and never mixed with another message', () => {
    for (const es of singleSource.eventSets) {
      const model = new CommsModel();
      model.apply(setStart(es.id));
      for (const { setId, cue } of scenarioMessages()) if (setId === es.id) model.apply(cue);
      const pages = model.pendingMessages();
      expect(pages.length, es.id).toBeLessThanOrEqual(COMMS_MESSAGE_PAGES_MAX);
      const seen = new Set<string>();
      for (const m of pages) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
        const src = scenarioMessages().find((x) => x.cue.id === m.id && x.setId === es.id)!.cue;
        // the page offers exactly the cards that message carried
        expect(m.cards.map((c) => c.id)).toEqual(src.cards!.map((c) => c.id));
        const lay = layoutMessagePage(m.text, m.cards.map((c) => ({ messageId: m.id, channel: m.channel, cardId: c.id, text: c.text })), measure, tagWidth(tagOf(m.channel)), area);
        expect(lay.cards.every((c) => c.card.messageId === m.id)).toBe(true);
        expect(lay.cards).toHaveLength(m.cards.length);
        expect(lay.fits).toBe(true);
      }
    }
  });

  it('only the I5 subset-on-arrival rule and the shared-card retire-on-choose rule ever drop a card in the real scenario (no retirement for space)', () => {
    type Pending = Map<string, string[]>; // message id -> offered card ids
    const pendingOf = (model: CommsModel): Pending => new Map(model.pendingMessages().map((m) => [m.id, m.cards.map((c) => c.id)]));
    const sorted = (p: Pending) => [...p].map(([id, cs]) => `${id}{${cs.join(',')}}`).sort();
    const family = (id: string) => id.split('-')[0];
    let choicesChecked = 0;
    let partialTrims = 0;
    for (const es of singleSource.eventSets) {
      const cues = scenarioMessages().filter((m) => m.setId === es.id).map((m) => m.cue);
      const replay = (n: number) => {
        const model = new CommsModel();
        model.apply(setStart(es.id));
        for (const cue of cues.slice(0, n)) model.apply(cue);
        return model;
      };
      for (let n = 0; n < cues.length; n++) {
        // arrival: only the subset rule may drop a card
        const model = replay(n);
        const before = pendingOf(model);
        const cue = cues[n];
        const ids = new Set((cue.cards ?? []).map((c) => c.id));
        const expected: Pending = new Map([...before].filter(([, cs]) => !(ids.size > 0 && cs.every((c) => ids.has(c)))));
        if (ids.size) expected.set(cue.id, [...ids]);
        model.apply(cue);
        expect(sorted(pendingOf(model)), `${es.id} after ${cue.id}`).toEqual(sorted(expected));
        // choice: every offered card at this point; only the chosen message and the cards other messages SHARE with it
        // (plus their cards of a shared card's family) may go; a message left with no cards retires
        for (const [mid, cs] of pendingOf(model)) {
          for (const cid of cs) {
            const m2 = replay(n + 1);
            const pre = pendingOf(m2);
            const chosen = new Set(pre.get(mid)!);
            const exp: Pending = new Map();
            for (const [oid, ocs] of pre) {
              if (oid === mid) continue;
              const fams = new Set(ocs.filter((c) => chosen.has(c)).map(family));
              const left = fams.size ? ocs.filter((c) => !chosen.has(c) && !fams.has(family(c))) : ocs;
              if (fams.size && left.length && left.length < ocs.length) partialTrims++;
              if (left.length) exp.set(oid, left);
            }
            expect(m2.choose(mid, cid), `${es.id} ${mid}/${cid}`).toEqual({ kind: 'reply', messageId: mid, cardId: cid });
            expect(sorted(pendingOf(m2)), `${es.id} after ${cue.id}, choose ${mid}/${cid}`).toEqual(sorted(exp));
            choicesChecked++;
          }
        }
      }
    }
    expect(choicesChecked).toBeGreaterThan(20);
    expect(partialTrims).toBeGreaterThan(0); // the real dep-climb/atc-wx trim is exercised, not only whole retirements
  });

  it('RECENT shows the last three messages at body, whole, in one part for every real run of three', () => {
    for (const es of singleSource.eventSets) {
      const msgs = scenarioMessages().filter((m) => m.setId === es.id).map((m) => m.cue);
      for (let i = 0; i + 3 <= msgs.length; i++) {
        const last3 = msgs.slice(i, i + 3).reverse().map((m) => ({ id: m.id, text: m.text, tag: tagOf(m.channel) }));
        const parts = layoutRecent(last3, measure, tagWidth, area, 1);
        expect(parts.flat().map((p) => p.id)).toEqual(last3.map((m) => m.id));
        for (const p of parts.flat()) expect(p.lines.join(' ')).toBe(last3.find((m) => m.id === p.id)!.text);
        expect(parts.length, `${es.id} window ${i}`).toBe(1);
      }
    }
  });

  it('the printout note is plain ASCII and one line in the page area', () => {
    expect(PRINTOUT_NOTE).toBe('New printout on kneeboard');
    expect(PRINTOUT_NOTE).toMatch(/^[\x20-\x7e]+$/);
    expect(measure(PRINTOUT_NOTE)).toBeLessThan(area.w);
  });

  it('no message or card text is drawn below THEME body (source scan of the comms drawing code)', () => {
    for (const f of ['comms.ts', 'cardLayout.ts']) {
      const src = readFileSync(new URL(`../../src/xr/panels/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/['"]min['"]/);
    }
    expect(THEME.text.capM.body).toBeGreaterThan(THEME.text.minHeightM);
  });

  it('I5: when the 120 s "say intentions" prompt re-offers the decision cards, the older set retires and only one set is offered', () => {
    const intentions = scenarioMessages().find((m) => m.cue.id === 'ctr-intentions')!.cue;
    const prompt = singleSource.softTimeout!.promptCue as Extract<WorldCue, { kind: 'message' }>;
    expect(prompt.id).toBe('ctr-say-intentions');
    const model = new CommsModel();
    model.apply(setStart('es4-decision'));
    model.apply(intentions);
    expect(model.pendingCards().map((c) => c.messageId)).toEqual(Array(intentions.cards!.length).fill('ctr-intentions'));
    model.apply(prompt);
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['ctr-say-intentions']);
    const cards = model.pendingCards();
    expect(cards).toHaveLength(prompt.cards!.length);
    expect(new Set(cards.map((c) => c.cardId)).size).toBe(cards.length); // no duplicated card id
    // the retired message cannot be answered any more: exactly one reply can ever be emitted for the decision
    expect(model.choose('ctr-intentions', 'dec-return')).toBeNull();
    expect(model.choose('ctr-say-intentions', 'dec-return')).toEqual({ kind: 'reply', messageId: 'ctr-say-intentions', cardId: 'dec-return' });
    expect(model.pendingCards()).toEqual([]);
    // its text is still in the log
    expect(model.lastMessages(3).map((m) => m.id)).toContain('ctr-intentions');
  });

  it('I5 subset rule: an older message whose card ids are a subset of the new one retires', () => {
    const model = new CommsModel();
    model.apply(setStart('x'));
    model.apply(msg('old', ['a', 'b']));
    model.apply(msg('new', ['a', 'b', 'c']));
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['new']);
    model.apply(msg('same', ['a', 'b', 'c']));
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['same']);
  });

  it('I5 partial overlap is NOT retired: real dep-climb vs atc-wx card sets both stay', () => {
    const msgs = scenarioMessages().map((m) => m.cue);
    const climb = msgs.find((m) => m.id === 'dep-climb')!;
    const wx = msgs.find((m) => m.id === 'atc-wx')!;
    const ids = (m: typeof climb) => m.cards!.map((c) => c.id);
    expect(ids(wx).some((i) => ids(climb).includes(i))).toBe(true); // they do overlap
    expect(ids(climb).every((i) => ids(wx).includes(i))).toBe(false); // but climb is not a subset
    const model = new CommsModel();
    model.apply(setStart('es2-takeoff-climb'));
    model.apply(climb);
    model.apply(wx);
    expect(model.pendingMessages().map((m) => m.id).sort()).toEqual(['atc-wx', 'dep-climb']);
  });

  it('I5 reachable path: dec-continue -> reconsider -> dsp-reoffer, then ctr-say-intentions leaves ONE decision set', () => {
    const msgs = scenarioMessages().map((m) => m.cue);
    const get = (id: string) => msgs.find((m) => m.id === id)!;
    const model = new CommsModel();
    model.apply(setStart('es4-decision'));
    model.apply(get('ctr-intentions'));
    expect(model.choose('ctr-intentions', 'dec-continue')).not.toBeNull();
    model.apply(get('dsp-concern'));
    expect(model.choose('dsp-concern', 'reconsider')).not.toBeNull();
    model.apply(get('dsp-reoffer'));
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['dsp-reoffer']);
    model.apply(singleSource.softTimeout!.promptCue as Extract<WorldCue, { kind: 'message' }>);
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['ctr-say-intentions']);
    const ids = model.pendingCards().map((c) => c.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(model.choose('dsp-reoffer', 'dec-return')).toBeNull();
  });

  it('never retires for space: more unanswered messages than pads all keep their cards', () => {
    const model = new CommsModel();
    model.apply(setStart('x'));
    for (let i = 0; i < COMMS_MESSAGE_PAGES_MAX + 3; i++) model.apply(msg(`m${i}`, [`c${i}`]));
    expect(model.pendingMessages()).toHaveLength(COMMS_MESSAGE_PAGES_MAX + 3);
    expect(model.choose('m0', 'c0')).not.toBeNull();
  });

  it('retire-on-choose, reverse-order path: after choosing dec-return no other decision cards remain', () => {
    const msgs = scenarioMessages().map((m) => m.cue);
    const get = (id: string) => msgs.find((m) => m.id === id)!;
    const model = new CommsModel();
    model.apply(setStart('es4-decision'));
    model.apply(get('ctr-intentions'));
    expect(model.choose('ctr-intentions', 'dec-continue')).not.toBeNull();
    model.apply(get('dsp-concern')); // unanswered past 120 s
    model.apply(singleSource.softTimeout!.promptCue as Extract<WorldCue, { kind: 'message' }>);
    expect(model.choose('dsp-concern', 'reconsider')).not.toBeNull();
    model.apply(get('dsp-reoffer')); // not a superset of ctr-say-intentions: both offered on arrival
    expect(model.pendingMessages().map((m) => m.id).sort()).toEqual(['ctr-say-intentions', 'dsp-reoffer']);
    expect(model.choose('dsp-reoffer', 'dec-return')).toEqual({ kind: 'reply', messageId: 'dsp-reoffer', cardId: 'dec-return' });
    expect(model.pendingCards()).toEqual([]);
    expect(model.choose('ctr-say-intentions', 'dec-divert-alt1')).toBeNull();
  });

  it('retire-on-choose, Manual double deviation: dev-left on atc-wx removes only the shared dev-* cards; dep-readback stays answerable', () => {
    const msgs = scenarioMessages().map((m) => m.cue);
    const model = new CommsModel();
    model.apply(setStart('es2-takeoff-climb'));
    model.apply(msgs.find((m) => m.id === 'dep-climb')!);
    model.apply(msgs.find((m) => m.id === 'atc-wx')!);
    expect(model.choose('atc-wx', 'dev-left')).not.toBeNull();
    // (a) dep-climb no longer offers dev-left/dev-right (no contradictory deviation) but still offers its own readback
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['dep-climb']);
    expect(model.pendingCards().map((c) => `${c.messageId}/${c.cardId}`)).toEqual(['dep-climb/dep-readback']);
    expect(model.choose('dep-climb', 'dev-right')).toBeNull();
    expect(model.choose('dep-climb', 'dev-left')).toBeNull();
    expect(model.choose('dep-climb', 'dep-readback')).toEqual({ kind: 'reply', messageId: 'dep-climb', cardId: 'dep-readback' });
    expect(model.pendingCards()).toEqual([]);
  });

  it('retire-on-choose, Manual double deviation through the real engine: es2 has no "climb clearance not answered" reason', () => {
    const climbReason = singleSource.eventSets
      .find((s) => s.id === 'es2-takeoff-climb')!
      .checks.find((c) => c.id === 'es2-climb-readback')!.reason;
    expect(climbReason).toMatch(/climb clearance .*not answered/);
    const e = new ScenarioEngine(singleSource, { mode: 'external' });
    const model = new CommsModel();
    e.onCue((c) => model.apply(c.body));
    e.start();
    const reply = (mid: string, cid: string) => {
      const a = model.choose(mid, cid);
      if (a) e.dispatch(a);
      return a;
    };
    expect(reply('twr-hold', 'hold-readback')).not.toBeNull();
    for (let i = 0; i < 400 && e.status.eventSetId !== 'es2-takeoff-climb'; i++) e.tick(1);
    expect(e.status.eventSetId).toBe('es2-takeoff-climb');
    expect(reply('twr-takeoff', 'to-readback')).not.toBeNull();
    // the instructor sends the weather advice before the pilot answers the climb clearance: both are open
    expect(e.fireRule('es2-departure')).toBe(true);
    expect(e.fireRule('es2-wx-advice')).toBe(true);
    expect(model.pendingMessages().map((m) => m.id).sort()).toEqual(['atc-wx', 'dep-climb']);
    expect(reply('atc-wx', 'dev-left')).not.toBeNull();
    expect(reply('dep-climb', 'dev-right')).toBeNull(); // contradictory deviation impossible
    expect(reply('dep-climb', 'dep-readback')).not.toBeNull(); // the climb clearance is still answerable
    for (const [controlId, value] of [['ap.engage', true], ['ap.alt', 12000], ['ap.hdg', 60], ['ap.lateral', 'hdg'], ['ap.vertical', 'alt']] as const)
      e.dispatch({ kind: 'control', controlId, value } as PilotAction);
    for (let i = 0; i < 200 && e.status.eventSetId === 'es2-takeoff-climb' && e.status.run === 'running'; i++) e.tick(1);
    const def = singleSource.eventSets.find((s) => s.id === 'es2-takeoff-climb')!;
    const g = gradeEventSet(def, e.historyFor('es2-takeoff-climb'), 0);
    expect(g.reasons.length).toBeLessThan(3); // reasons are capped at 3: the absence below is not a truncation
    expect(g.reasons.map((r) => r.text)).not.toContain(climbReason);
  });

  it('retire-on-choose, Manual: a plan chosen on dsp-reoffer while ctr-intentions is open retires ctr-intentions whole (no "continue" left)', () => {
    const msgs = scenarioMessages().map((m) => m.cue);
    const get = (id: string) => msgs.find((m) => m.id === id)!;
    const model = new CommsModel();
    model.apply(setStart('es4-decision'));
    model.apply(get('ctr-intentions'));
    model.apply(get('dsp-reoffer'));
    expect(model.pendingMessages().map((m) => m.id)).toEqual(['dsp-reoffer', 'ctr-intentions']);
    expect(model.choose('dsp-reoffer', 'dec-divert-alt1')).not.toBeNull();
    expect(model.pendingCards()).toEqual([]);
    expect(model.choose('ctr-intentions', 'dec-continue')).toBeNull();
  });

  it('Manual worst case (es4-pa, center-asks, concern, reconsider, no replies): pa-cabin stays answerable and within 2 taps', () => {
    const es = singleSource.eventSets.find((e) => e.id === 'es4-decision')!;
    const cues = es.rules.filter((r) => ['es4-pa', 'es4-center-asks', 'es4-concern', 'es4-reconsider'].includes(r.id)).flatMap((r) => r.cues);
    const model = new CommsModel();
    model.apply(setStart(es.id));
    for (const c of [...es.startCues, ...cues]) model.apply(c);
    const open = model.pendingMessages().map((m) => m.id);
    expect(open).toContain('pa-cabin');
    expect(open.length).toBeLessThanOrEqual(COMMS_MESSAGE_PAGES_MAX); // each has its own pad: 1 tap to open the page, 1 tap on the card
    expect(model.choose('pa-cabin', 'pa-clear')).toEqual({ kind: 'reply', messageId: 'pa-cabin', cardId: 'pa-clear' });
  });

  it('"DISPATCH" fits its page pad at body (real bold Inter widths)', () => {
    const face = inter.bold;
    const adv = new Map<string, number>(face.chars.map((c: { char: string; xadvance: number }) => [c.char, c.xadvance]));
    const w = ([...'DISPATCH'].reduce((a, ch) => a + adv.get(ch)!, 0) / face.info.size) * fontSizeForCap(THEME.text.capM.body) * 1.06;
    expect(w).toBeLessThanOrEqual(commsGeo().dots[0].w - 0.008);
  });

  it('every scenario hint fits the kneeboard hint box and every briefing entry is at most 3 pages', () => {
    const g2 = kneeboardGeo();
    const lh = lineHeightM('min');
    const hintLines = Math.floor((g2.hintBox.top - g2.hintBox.bottom - 0.004) / lh);
    const linesPerPage = Math.floor((g2.text.top - g2.text.bottom) / lh);
    const m = (t: string) => t.length * 0.55 * fontSizeForCap(THEME.text.capM.min);
    for (const es of singleSource.eventSets) for (const h of es.hints) expect(wrapText(h, g2.hintBox.w - 0.012, m).length, h).toBeLessThanOrEqual(hintLines);
    const kb = new KneeboardModel(singleSource.briefing, singleSource.eventSets);
    kb.setLayout((t) => wrapText(t, g2.text.w, m), linesPerPage);
    for (const b of singleSource.briefing) expect(wrapText(b.body, g2.text.w, m).length, b.id).toBeLessThanOrEqual(linesPerPage * 3);
  });
});

describe('panel models ignore presses while the engine is not live (T11 fix round 1)', () => {
  it('reply card: nothing changes while not live; the same press works once afterwards', () => {
    const c = new CommsModel();
    c.apply(setStart('es1'));
    c.apply(msg('m1', ['a', 'b']));
    c.live = false;
    expect(c.choose('m1', 'a')).toBeNull();
    expect(c.pendingCards().map((x) => x.cardId)).toEqual(['a', 'b']);
    c.live = true;
    expect(c.choose('m1', 'a')).toEqual({ kind: 'reply', messageId: 'm1', cardId: 'a' });
    expect(c.pendingCards()).toEqual([]);
    expect(c.choose('m1', 'a')).toBeNull();
  });

  it('checklist row: the tick is not recorded while not live', () => {
    const cl = new ChecklistModel(singleSource.checklists);
    cl.open('beforeTakeoff');
    const id = cl.current()!.items[0].id;
    cl.live = false;
    expect(cl.tick(id)).toBeNull();
    expect(cl.isTicked(id)).toBe(false);
    expect(cl.tickOrder()).toEqual([]);
    cl.live = true;
    expect(cl.tick(id)!.action).toEqual({ kind: 'checklistItem', checklistId: 'beforeTakeoff', itemId: id });
    expect(cl.tick(id)).toBeNull();
  });

  it('hint: not revealed or counted while not live', () => {
    const kb = new KneeboardModel(singleSource.briefing, singleSource.eventSets);
    const es1 = singleSource.eventSets[0];
    kb.onEventSet(es1.id);
    kb.live = false;
    expect(kb.pressHint()).toBeNull();
    expect(kb.hintText()).toBeNull();
    kb.live = true;
    expect(kb.pressHint()).toEqual({ kind: 'hint', eventSetId: es1.id });
    expect(kb.hintText()).toBe(es1.hints[0]); // the first hint, so the paused press did not use it up
  });

  it('kneeboard page browsing stays usable while not live', () => {
    const kb = new KneeboardModel(singleSource.briefing, singleSource.eventSets);
    kb.setLayout((t) => [t], 1);
    kb.live = false;
    kb.next();
    expect(kb.pageIndex()).toBe(1);
    kb.prev();
    expect(kb.pageIndex()).toBe(0);
  });

  it('route cell: selection and action are both unchanged while not live', () => {
    const r = new RouteModel(singleSource.airports, 'dest');
    r.live = false;
    expect(r.select('alt1')).toBeNull();
    expect(r.selected()).toBe('dest');
    r.live = true;
    expect(r.select('alt1')).not.toBeNull();
    expect(r.selected()).toBe('alt1');
  });
});

it('crew never changes recent, pending pages or reply cards', () => {
 const m = new CommsModel(); m.apply(msg('radio', ['reply'])); const recent = m.lastMessages(3); const pending = m.pendingMessages(); const cards = m.pendingCards();
 expect(m.apply({ kind: 'message', channel: 'crew', id: 'crew', text: 'Crew line' })).toBe(false); expect(m.lastMessages(3)).toEqual(recent); expect(m.pendingMessages()).toEqual(pending); expect(m.pendingCards()).toEqual(cards);
});

// ---- T41: models take another flight at run time and keep nothing of the old one ----
describe('panel models take a new scenario (T41)', () => {
  const other = {
    checklists: [{ id: 'other-list', title: 'Other list', items: [{ id: 'o1', text: 'First other item' }] }],
    briefing: [{ id: 'other-brief', title: 'Other briefing', body: 'Other briefing text.' }],
    eventSets: [{ id: 'other-set', hints: ['Other hint one'] }],
    airports: [{ id: 'oa', name: 'Other Alpha' }, { id: 'ob', name: 'Other Bravo' }],
  };

  it('ChecklistModel.setDefs forgets the open list, its ticks and the old definitions', () => {
    const m = new ChecklistModel(singleSource.checklists);
    const first = singleSource.checklists[0];
    m.open(first.id);
    expect(m.tick(first.items[0].id)).not.toBeNull();
    m.setDefs(other.checklists);
    expect(m.current()).toBeNull();
    expect(m.open(first.id)).toBe(false);
    expect(m.open('other-list')).toBe(true);
    expect(m.isTicked('o1')).toBe(false);
    expect(m.tickOrder()).toEqual([]);
    m.setDefs(singleSource.checklists); // back to the first: its old tick is gone too
    m.open(first.id);
    expect(m.isTicked(first.items[0].id)).toBe(false);
  });

  it('KneeboardModel.setScenario replaces the briefing and hints and drops printouts, the shown hint and the page', () => {
    const m = new KneeboardModel(singleSource.briefing, singleSource.eventSets);
    m.onEventSet(singleSource.eventSets[0].id);
    expect(m.pressHint()).not.toBeNull();
    m.addPrintout('old-print', 'Old printout', 'Old printout body');
    m.setScenario(other.briefing, other.eventSets);
    expect(m.entries().map((e) => e.id)).toEqual(['other-brief']);
    expect(m.hintText()).toBeNull();
    expect(m.hintAvailable()).toBe(false);
    expect(m.pageIndex()).toBe(0);
    expect(m.pressHint()).toBeNull(); // no set started yet
    m.onEventSet('other-set');
    expect(m.pressHint()).toEqual({ kind: 'hint', eventSetId: 'other-set' });
    expect(m.hintText()).toBe('Other hint one');
    m.onEventSet(singleSource.eventSets[0].id); // an old set id has no hints any more
    expect(m.pressHint()).toBeNull();
  });

  it('RouteModel.setAirports replaces the rows and selects the new initial airport', () => {
    const m = new RouteModel(singleSource.airports, 'dest');
    m.setAirports(other.airports, 'ob');
    expect(m.rows().map((r) => r.id)).toEqual(['oa', 'ob']);
    expect(m.selected()).toBe('ob');
    expect(m.select('dest')).toBeNull();
    expect(m.select('oa')).toEqual({ kind: 'control', controlId: 'route.destination', value: 'oa' });
    m.setDestination('dest'); // an old airport id is ignored
    expect(m.selected()).toBe('oa');
  });

  it('CommsModel.reset drops every message of the old flight', () => {
    const m = new CommsModel();
    m.apply({ kind: 'message', id: 'old-1', channel: 'atc', text: 'Old words', cards: [{ id: 'dec-a', text: 'A' }] });
    m.reset();
    expect(m.lastMessages(5)).toEqual([]);
    expect(m.pendingCards()).toEqual([]);
    expect(m.currentSetId()).toBeNull();
  });
});
