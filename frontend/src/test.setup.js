// Ensure Node-like process hooks exist for libraries that subscribe to process events (e.g., msw/node)
// Robust minimal process shim for jsdom tests
const proc = (globalThis.process || global.process || {});
if (typeof proc.on !== 'function') proc.on = () => {};
if (typeof proc.removeListener !== 'function') proc.removeListener = () => {};
// eslint-disable-next-line no-global-assign
globalThis.process = proc;
// Ensure Node's global alias also sees the same object
// eslint-disable-next-line no-undef
global.process = proc;
// eslint-disable-next-line no-console
// No test-time console logging; keep setup silent

// JSDOM sometimes lacks a StorageEvent constructor; provide a basic one for code that dispatches it.
if (typeof globalThis.StorageEvent === 'undefined') {
  class StorageEventPolyfill extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.key = options.key || null;
      this.newValue = options.newValue || null;
      this.oldValue = options.oldValue || null;
      this.storageArea = options.storageArea || null;
      this.url = options.url || '';
    }
  }
  // eslint-disable-next-line no-global-assign
  globalThis.StorageEvent = StorageEventPolyfill;
}
