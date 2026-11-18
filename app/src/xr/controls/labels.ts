/**
 * Label panels: UIKitML documents (Inter, the UI kit default font) carrying every printed label and
 * value readout. Controls write text through setLabel(); it is applied as soon as the panel document
 * has loaded (documents load asynchronously after the PanelUI component is added).
 */
import type { UIKitDocument } from '@iwsdk/core';

interface LabelProps {
  text?: string;
  color?: string;
}

const docs = new Map<string, UIKitDocument>();
const pending = new Map<string, Map<string, LabelProps>>();

function apply(doc: UIKitDocument, elementId: string, props: LabelProps): void {
  const el = doc.getElementById(elementId);
  if (el) el.setProperties(props as Record<string, unknown>);
}

/** Set the text/colour of element `elementId` inside label panel `panelKey`. */
export function setLabel(panelKey: string, elementId: string, props: LabelProps): void {
  const doc = docs.get(panelKey);
  if (doc) {
    apply(doc, elementId, props);
    return;
  }
  let m = pending.get(panelKey);
  if (!m) pending.set(panelKey, (m = new Map()));
  m.set(elementId, { ...m.get(elementId), ...props });
}

/** Called by the control system when a LabelPanel entity's document becomes available. */
export function attachLabelDocument(panelKey: string, doc: UIKitDocument): void {
  docs.set(panelKey, doc);
  const m = pending.get(panelKey);
  if (m) {
    for (const [id, props] of m) apply(doc, id, props);
    pending.delete(panelKey);
  }
}
