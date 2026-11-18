/**
 * Guided flight: turns a step's target (an ActionMatch) into the names of the pads to frame.
 * Pure: type-only imports, so it runs in node. Pad names are the mesh names in the shared pad registry.
 */
import type { AircraftState } from '../../contracts/aircraft';
import type { ActionMatch } from '../../contracts/scenario';

export interface GuidePanels {
  comms: {
    pendingCards(): { messageId: string; cardId: string }[];
    placementOf(cardId: string, messageId?: string): { page: number; slot: number } | undefined;
    currentPage(): number;
    /** Mesh name of the pad that opens page `page` (the MORE pad when it has none of its own). */
    pagePadName(page: number): string | undefined;
  };
  checklist: {
    rowOf(itemId: string): { page: number; slot: number } | undefined;
    pageIndex(): number;
  };
}

export const MAX_FRAMES = 4;

function stepper(id: string, current: number, target: number, wrap360: boolean): string[] {
  if (current === target) return [];
  let up = target > current;
  if (wrap360) {
    const diff = (((target - current) % 360) + 360) % 360;
    if (diff === 0) return [];
    up = diff <= 180;
  }
  return [`pad:${id}:${up ? 'plus' : 'minus'}`];
}

function reply(m: Extract<ActionMatch, { kind: 'reply' }>, panels: GuidePanels): string[] {
  const out: string[] = [];
  const { comms } = panels;
  for (const c of comms.pendingCards()) {
    if (m.messageId !== undefined && c.messageId !== m.messageId) continue;
    if (m.cardId !== undefined && c.cardId !== m.cardId) continue;
    const at = comms.placementOf(c.cardId, c.messageId);
    if (!at) continue;
    const name = at.page === comms.currentPage() ? `pad:comms.card.${at.slot}` : comms.pagePadName(at.page);
    if (name) out.push(name);
  }
  return out;
}

export function padNamesFor(target: ActionMatch, state: AircraftState, panels: GuidePanels): string[] {
  switch (target.kind) {
    case 'control': {
      const id = target.controlId;
      if (!id) return [];
      const v = target.value;
      if (typeof v === 'number') {
        if (id === 'ap.hdg') return stepper(id, state.ap.hdg, v, true);
        if (id === 'ap.alt') return stepper(id, state.ap.alt, v, false);
        if (id === 'baro.set') return stepper(id, state.baroHpa, v, false);
      }
      if ((id === 'ap.lateral' || id === 'ap.vertical') && typeof v === 'string') return [`pad:${id}:${v}`];
      if (id === 'route.destination' && typeof v === 'string') return [`pad:route.${v}`];
      return [`pad:${id}`];
    }
    case 'reply':
      return reply(target, panels);
    case 'checklistItem': {
      if (target.itemId === undefined) return [];
      const at = panels.checklist.rowOf(target.itemId);
      if (!at) return [];
      const cur = panels.checklist.pageIndex();
      return [at.page === cur ? `pad:check.row.${at.slot}` : at.page > cur ? 'pad:check.next' : 'pad:check.prev'];
    }
    case 'alertAck':
      return ['pad:alerts.ack'];
    case 'hint':
      return [];
  }
}

export function padNamesForAll(targets: readonly ActionMatch[], state: AircraftState, panels: GuidePanels): string[] {
  const out: string[] = [];
  for (const t of targets) {
    for (const n of padNamesFor(t, state, panels)) {
      if (!out.includes(n)) out.push(n);
      if (out.length >= MAX_FRAMES) return out;
    }
  }
  return out;
}
