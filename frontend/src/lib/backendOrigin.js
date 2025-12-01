// Centralized backend origin detection
// Returns '' in production (same-origin) and 'http://localhost:3001' during local dev.
export function getBackendOrigin() {
  try {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (host === 'localhost' || host === '127.0.0.1') {
      const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
      return `${protocol}//${host}:3001`;
    }
  } catch (_) {}
  return '';
}
