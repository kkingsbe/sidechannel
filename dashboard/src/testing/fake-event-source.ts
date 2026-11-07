/** Minimal EventSource stand-in for jsdom tests (jsdom has none). Install with `vi.stubGlobal('EventSource', FakeEventSource)`. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((message: { data: string }) => void)[]>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (message: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  open() { this.readyState = FakeEventSource.OPEN; this.onopen?.(); }
  emit(type: string, data: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) }); }
  close() { this.readyState = FakeEventSource.CLOSED; }
  static reset() { FakeEventSource.instances = []; }
}
