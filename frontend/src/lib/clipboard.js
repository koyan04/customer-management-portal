/**
 * Cross-platform clipboard copy helper that works reliably on:
 * - Desktop browsers (Chrome, Firefox, Safari, Edge)
 * - Mobile devices (iOS Safari, Android Chrome, mobile webviews)
 * - Both secure (HTTPS) and non-secure (HTTP / local IP) environments
 *
 * Handles mobile browser restrictions:
 * 1. navigator.clipboard.writeText may be undefined on HTTP or reject if user gesture expires.
 * 2. iOS Safari requires specific selection range creation on the textarea.
 * 3. Prevents viewport scrolling, auto-zooming, or virtual keyboard popping on mobile.
 */
export async function copyToClipboard(text) {
  if (text === null || text === undefined) return false;
  const str = String(text);
  if (!str) return false;

  // 1. Try modern Async Clipboard API first (supported on HTTPS)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (err) {
      console.warn('[clipboard] navigator.clipboard.writeText failed, falling back:', err);
    }
  }

  // 2. Fallback using temporary textarea + document.execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = str;

    // Prevent virtual keyboard popup, viewport scroll, and auto-zoom on mobile
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.fontSize = '16px'; // 16px prevents iOS Safari from zooming in
    textArea.style.opacity = '0';

    document.body.appendChild(textArea);

    // iOS Safari selection quirk workaround
    const isIOS = typeof navigator !== 'undefined' && /ipad|iphone|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textArea.setSelectionRange(0, str.length);
    } else {
      textArea.focus({ preventScroll: true });
      textArea.select();
    }

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('[clipboard] execCommand fallback copy failed:', err);
    return false;
  }
}
