/**
 * The only @pmndrs/uikit-lucide icons this app ships (T16 cold start). vite.config.ts aliases the bare
 * '@pmndrs/uikit-lucide' import here: uikit-horizon imports CheckIcon (checkbox) and ChevronDownIcon (dropdown),
 * and @drawcall/uikitml registers whatever this module exports as markup tags (our .uikitml files use none).
 * Deep imports bypass the alias, so these resolve to the real package files.
 */
export { Check, CheckIcon } from '@pmndrs/uikit-lucide/dist/Check.js';
export { ChevronDown, ChevronDownIcon } from '@pmndrs/uikit-lucide/dist/ChevronDown.js';
