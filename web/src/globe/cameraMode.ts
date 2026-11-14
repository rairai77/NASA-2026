// Shared camera-mode flag so the orbit controls and the 3D first-person view don't fight over input.
type Listener = (fp: boolean) => void;
let fpActive = false;
const listeners = new Set<Listener>();

/** True while the 3D "Stand here" view owns the camera; orbit controls must ignore input then. */
export function isFirstPersonActive(): boolean { return fpActive; }

export function setFirstPersonActive(on: boolean): void {
  if (on === fpActive) return;
  fpActive = on;
  listeners.forEach((l) => l(on));
}

export function onFirstPersonChange(l: Listener): () => void { listeners.add(l); return () => listeners.delete(l); }
