// Ensure Node-like process hooks exist for libraries that subscribe to process events (e.g., msw/node)
import '@testing-library/jest-dom/vitest';
// Ensure jest-dom matchers are wired even if the auto-extension fails
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
// Guarded extend to avoid errors if already extended
try { expect.extend(matchers); } catch (_) {}
// Robust minimal process shim for jsdom tests
const proc = (globalThis.process || global.process || {});
if (typeof proc.on !== 'function') proc.on = () => {};
if (typeof proc.removeListener !== 'function') proc.removeListener = () => {};
globalThis.process = proc; // share shim
global.process = proc; // alias for libs expecting global.process
// Intentionally keep console available; tests may assert logs.

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
  globalThis.StorageEvent = StorageEventPolyfill;
}

// Provide a basic URL.createObjectURL implementation for tests that create Blob URLs (e.g., downloads)
if (!globalThis.URL) { globalThis.URL = {}; }
if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = () => 'blob://test-url';
}

// Avoid jsdom navigation errors when simulating anchor.click() for downloads
try {
  if (typeof HTMLAnchorElement !== 'undefined' && HTMLAnchorElement.prototype && typeof HTMLAnchorElement.prototype.click === 'function') {
    const originalClick = HTMLAnchorElement.prototype.click;
    // Wrap to no-op navigation while preserving any spies
    HTMLAnchorElement.prototype.click = function patchedClick() {
      try { return undefined; } catch (_) { return undefined; }
    };
    // Keep a reference if some test wants to restore
    HTMLAnchorElement.prototype.__originalClick = originalClick;
  }
} catch (_) {
  // ignore
}
