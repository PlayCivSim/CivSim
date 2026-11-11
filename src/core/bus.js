// Minimal event bus decoupling simulation systems from UI, audio and effects.
export class Bus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of hs) { try { fn(payload); } catch (e) { console.error('bus handler', type, e); } }
    const any = this.handlers.get('*');
    if (any) for (const fn of any) { try { fn(type, payload); } catch (e) { console.error(e); } }
  }
  clear() { this.handlers.clear(); }
}

export const bus = new Bus();
