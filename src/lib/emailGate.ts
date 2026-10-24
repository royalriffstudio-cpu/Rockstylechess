// The "verify your email" prompt (components/auth/EmailGateModal.tsx) is opened from two places that have nothing in
// common: REST calls (api.ts request()) and socket refusals (`account:gate`). This is the tiny bridge between them.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onEmailGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitEmailGate(): void {
  listeners.forEach((l) => l());
}
