/** System-free ECS component declarations for the cockpit (registered via src/components.ts). */
import { createComponent, Types } from '@iwsdk/core';

/** One pokeable/ray-able pad. `handler` indexes the module-level pad registry in controlBase.ts. */
export const CockpitPad = createComponent('CockpitPad', {
  handler: { type: Types.Int32, default: -1 },
});

/** A UIKitML label panel; `key` identifies which binder (controls' readouts) attaches to it. */
export const LabelPanel = createComponent('LabelPanel', {
  key: { type: Types.String, default: '' },
});

/** Dev-only action log readable with `npx @iwsdk/cli ecs query`: counts and the last emitted action. */
export const DevActionLog = createComponent('DevActionLog', {
  count: { type: Types.Int32, default: 0 },
  last: { type: Types.String, default: '' },
});

/** Dev-only snapshot of display state for `ecs query` (Task 9): which panel is magnified, alert list, ACK/tab press counters. */
export const DevDisplaysState = createComponent('DevDisplaysState', {
  magnified: { type: Types.String, default: '' },
  alerts: { type: Types.String, default: '' },
  tabPresses: { type: Types.Int32, default: 0 },
});

/** Dev-only snapshot of the Task 10 panels for `ecs query`: pending reply cards, checklist ticks, route, hint, kneeboard page, Pause presses. */
export const DevPanelsState = createComponent('DevPanelsState', {
  cards: { type: Types.String, default: '' },
  checklist: { type: Types.String, default: '' },
  destination: { type: Types.String, default: '' },
  hint: { type: Types.String, default: '' },
  page: { type: Types.Int32, default: 0 },
  pauses: { type: Types.Int32, default: 0 },
});

/** Dev-only snapshot of the Task 11 app flow for `ecs query`: flow state, current Event Set, debrief grades. */
export const DevFlowState = createComponent('DevFlowState', {
  flow: { type: Types.String, default: '' },
  eventSet: { type: Types.String, default: '' },
  grades: { type: Types.String, default: '' },
});
