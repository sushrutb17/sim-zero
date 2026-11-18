import { defineComponents } from '@iwsdk/core';
import { CockpitPad, DevActionLog, DevDisplaysState, DevFlowState, DevPanelsState, LabelPanel } from './xr/controls/components.js';

export default defineComponents([CockpitPad, LabelPanel, DevActionLog, DevDisplaysState, DevPanelsState, DevFlowState]);
