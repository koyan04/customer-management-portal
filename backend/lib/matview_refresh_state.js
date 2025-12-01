// Tiny proxy to read matview refresh state without importing the full refresher in modules
// that only want to check status.

try {
  const { isMatviewRefreshRunning, getMatviewRefreshState } = require('./matview_refresh');
  module.exports = { isMatviewRefreshRunning, getMatviewRefreshState };
} catch (e) {
  module.exports = {
    isMatviewRefreshRunning: () => null,
    getMatviewRefreshState: () => ({ isRunning: null, pending: null })
  };
}
