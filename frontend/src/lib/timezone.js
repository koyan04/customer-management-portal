// Minimal timezone helpers for formatting using the app-selected timezone
// Stored timezone key in localStorage: 'app.timezone'

export function getStoredTimezone() {
  try {
    const v = localStorage.getItem('app.timezone');
    return v === null ? 'auto' : v;
  } catch (e) {
    return 'auto';
  }
}

export function setStoredTimezone(val) {
  try {
    if (!val || val === 'auto') localStorage.removeItem('app.timezone');
    else localStorage.setItem('app.timezone', val);
  } catch (e) {}
}

// formatWithAppTZ(dateLike, options, locale)
// dateLike: Date | ISO string | number
// options: Intl.DateTimeFormat options
// locale: optional locale string
export default function formatWithAppTZ(dateLike, options = {}, locale) {
  try {
    const tz = getStoredTimezone();
    const date = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    const opts = { ...(options || {}) };
    if (tz && tz !== 'auto') opts.timeZone = tz;
    // If no specific style passed, provide a sensible default
    if (!opts.dateStyle && !opts.timeStyle && !opts.year && !opts.hour) {
      // default: medium date + short time
      opts.dateStyle = 'medium';
      opts.timeStyle = 'short';
    }
    if (locale) return new Intl.DateTimeFormat(locale, opts).format(date);
    return new Intl.DateTimeFormat(undefined, opts).format(date);
  } catch (e) {
    try { return new Date(dateLike).toString(); } catch (_) { return '';} 
  }
}

export function isSameDayInAppTZ(a, b) {
  try {
    const tz = getStoredTimezone();
    const dateA = (a instanceof Date) ? a : new Date(a);
    const dateB = (b instanceof Date) ? b : new Date(b);
    if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return false;
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (tz && tz !== 'auto') opts.timeZone = tz;
    const fmt = (d) => new Intl.DateTimeFormat(undefined, opts).format(d);
    return fmt(dateA) === fmt(dateB);
  } catch (e) { return false; }
}
