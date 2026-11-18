/**
 * Kneeboard: the briefing pages, then each printout as it arrives (previous/next pads), a "Need a hint?" button that emits ONE
 * {kind:'hint', eventSetId} per press and shows the next unused hint of the current event set, and a Pause button (a callback
 * to Task 11: Pause is not a PilotAction). Hint and Pause are trainer-layer buttons (violet outline). The practice switch
 * (Task 8) and the printed title live on the kneeboard's label panel above this canvas.
 */
import type { Entity, Vector3, World } from '@iwsdk/core';
import type { EventBus } from '../../bus/eventBus';
import type { Scenario } from '../../contracts/scenario';
import { THEME } from '../theme';
import { kneeboardGeo } from '../cockpit/layout';
import { KneeboardModel } from './panelModel';
import { ZoneCanvas, lineHeightM } from './draw';
import { wrapText } from './textLayout';
import { createPanelPad, type PanelPad } from './panelPad';
import type { PanelView } from './view';

export interface KneeboardView extends PanelView {
  addPrintout(id: string, title: string, body: string): void;
  onEventSet(id: string): void;
  onPause(cb: () => void): void;
  /** A different flight (T41): its briefing and hints replace the old ones; printouts, hint and page go. */
  setScenario(scenario: Pick<Scenario, 'briefing' | 'eventSets'>): void;
  model: KneeboardModel;
}

export function createKneeboard(world: World, bus: EventBus, zone: Entity, panelZ: number, scenario: Pick<Scenario, 'briefing' | 'eventSets'>): KneeboardView {
  const g = kneeboardGeo();
  const model = new KneeboardModel(scenario.briefing, scenario.eventSets);
  const zc = new ZoneCanvas(g.W, g.H);
  zc.panel.mesh.name = 'panel:kneeboard';
  zc.panel.mesh.position.z = panelZ;
  zone.object3D!.add(zc.panel.mesh);
  const pauseCbs: Array<() => void> = [];
  let sig = '';

  const lh = lineHeightM('min');
  const linesPerPage = Math.floor((g.text.top - g.text.bottom) / lh);
  const hintLines = Math.floor((g.hintBox.top - g.hintBox.bottom - 0.004) / lh);
  const textW = g.text.w;
  model.setLayout((t) => wrapText(t, textW, zc.measurer('min', 500)), linesPerPage);

  const pad = (id: 'prev' | 'next' | 'hint' | 'pause', onPress: () => void): PanelPad => {
    const p = createPanelPad(world, zone, `kb.${id}`, onPress);
    const r = g[id];
    p.rect(r.cx, r.cy, r.w, r.h);
    return p;
  };
  const prev = pad('prev', () => {
    model.prev();
    zc.panel.markDirty();
  });
  const next = pad('next', () => {
    model.next();
    zc.panel.markDirty();
  });
  const hint = pad('hint', () => {
    const action = model.pressHint();
    if (action) bus.emitAction(action);
    zc.panel.markDirty();
  });
  const pause = pad('pause', () => {
    for (const cb of pauseCbs) cb();
  });
  const all = [prev, next, hint, pause];

  const level = (p: PanelPad) => (p.press() > 0.5 ? 'p' : p.hover() > 0.5 ? 'h' : '-');

  function button(p: PanelPad, r: { cx: number; cy: number; w: number; h: number }, label: string, opts: { trainer?: boolean; disabled?: boolean } = {}): void {
    const fill = opts.disabled ? THEME.color.panel : p.press() > 0.5 ? THEME.color.pressedFill : p.hover() > 0.5 ? THEME.color.hoverFill : THEME.color.panelEdge;
    const stroke = opts.disabled ? { color: THEME.color.panelEdge, width: 0.0015 } : opts.trainer || p.hover() > 0.5 ? { color: THEME.color.accent, width: 0.002 } : undefined;
    zc.box(r.cx, r.cy, r.w, r.h, fill, stroke);
    const color = opts.disabled ? THEME.color.textDim : opts.trainer ? THEME.color.accent : THEME.color.text;
    zc.text(label, r.cx, r.cy, 'body', color, 'center', 700);
  }

  function draw(): void {
    zc.clear();
    const m = model.renderModel(hintLines);
    // page header: entry title (left), page x / y (right)
    const title = m.parts > 1 ? `${m.title} (${m.part}/${m.parts})` : m.title;
    const titleLines = wrapText(title, g.text.w - 0.045, zc.measurer('body', 700));
    zc.text(titleLines[0] + (titleLines.length > 1 ? '...' : ''), -g.W / 2 + 0.01, g.header.cy, 'body', THEME.color.text, 'left', 700);
    zc.text(`${m.pageNumber}/${m.pageCount}`, g.W / 2 - 0.01, g.header.cy, 'min', THEME.color.textDim, 'right', 600);
    zc.lines(m.lines, -g.W / 2 + 0.01, g.text.top, 'min', THEME.color.text, 'left', 500);
    button(prev, g.prev, 'PREV', { disabled: !m.canPrev });
    button(next, g.next, 'NEXT', { disabled: !m.canNext });
    // hint box (trainer layer)
    const hb = g.hintBox;
    zc.box(hb.cx, (hb.top + hb.bottom) / 2, hb.w, hb.top - hb.bottom, null, { color: m.hint.visible ? THEME.color.accent : THEME.color.panelEdge, width: 0.0015 });
    if (m.hint.visible) zc.lines(m.hint.lines, -hb.w / 2 + 0.006, hb.top - 0.004, 'min', THEME.color.accent, 'left', 600);
    else zc.text('Hints appear here', 0, (hb.top + hb.bottom) / 2, 'min', THEME.color.textDim, 'center', 500);
    button(hint, g.hint, 'HINT', { trainer: true, disabled: !m.hint.canAsk });
    button(pause, g.pause, 'PAUSE', { trainer: true });
  }
  zc.panel.setDraw(draw);

  return {
    model,
    addPrintout(id, title, body) {
      model.addPrintout(id, title, body);
      zc.panel.markDirty();
    },
    onEventSet(id) {
      model.onEventSet(id);
      zc.panel.markDirty();
    },
    onPause: (cb) => void pauseCbs.push(cb),
    setScenario(next) {
      model.setScenario(next.briefing, next.eventSets);
      zc.panel.markDirty();
    },
    tick(nowMs) {
      const s = all.map(level).join('');
      if (s !== sig) {
        sig = s;
        zc.panel.markDirty();
      }
      zc.panel.tick(nowMs);
    },
    reset() {
      model.reset();
      zc.panel.markDirty();
    },
    targets() {
      const t: Record<string, () => Vector3 | undefined> = {};
      t['kb:hint'] = () => hint.front();
      t['kb:pause'] = () => pause.front();
      t['kb:next'] = () => next.front();
      t['kb:prev'] = () => prev.front();
      return t;
    },
  };
}
