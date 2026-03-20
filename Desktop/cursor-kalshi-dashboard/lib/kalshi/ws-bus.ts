type WsListener = (data: unknown) => void;

const listeners = new Set<WsListener>();

export function emitWsData(data: unknown) {
  listeners.forEach((l) => {
    try {
      l(data);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeWsData(listener: WsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
