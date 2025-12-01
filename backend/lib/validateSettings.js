// Extracted validateSettings logic so it can be unit-tested independently
function parseNonNeg(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }
  return undefined;
}

function validateSettings(key, body) {
  const errors = [];
  const cleaned = {};
  if (key === 'database') {
    const host = typeof body.host === 'string' && body.host.trim() ? body.host.trim() : null;
    const port = Number(body.port);
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim() : null;
    const password = typeof body.password === 'string' ? body.password : undefined; // optional
    const database = typeof body.database === 'string' && body.database.trim() ? body.database.trim() : null;
    if (!host) errors.push('host is required');
    if (!Number.isFinite(port) || port < 1 || port > 65535) errors.push('port must be 1-65535');
    if (!user) errors.push('user is required');
    if (!database) errors.push('database is required');
    cleaned.host = host;
    cleaned.port = Number.isFinite(port) ? port : 5432;
    cleaned.user = user;
    if (typeof password !== 'undefined') cleaned.password = password;
    cleaned.database = database;
    cleaned.ssl = !!body.ssl;
  } else if (key === 'telegram') {
    // botToken is required for creation, but for updates we may omit it to preserve the existing token.
    if (typeof body.botToken !== 'undefined') {
      const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
      if (!botToken) errors.push('botToken is required');
      else cleaned.botToken = botToken;
    }
    const defaultChatId = typeof body.defaultChatId === 'string' || typeof body.defaultChatId === 'number' ? String(body.defaultChatId).trim() : '';
    if (defaultChatId && !/^[-]?\d+$/.test(defaultChatId)) errors.push('defaultChatId must be numeric');
  if (defaultChatId) cleaned.defaultChatId = defaultChatId;
    // messageTemplate is still accepted for backward compatibility
    if (typeof body.messageTemplate === 'string') cleaned.messageTemplate = body.messageTemplate;

    // notificationTime: accept a non-empty string (cron-like or '@daily'). Keep max length reasonable.
    if (typeof body.notificationTime === 'string') {
      const nt = body.notificationTime.trim();
      if (nt.length === 0) {
        // allow empty to mean unset; don't set cleaned.notificationTime
      } else if (nt.length > 255) {
        errors.push('notificationTime is too long');
      } else {
        cleaned.notificationTime = nt;
      }
    } else if (typeof body.notificationTime !== 'undefined' && body.notificationTime !== null) {
      errors.push('notificationTime must be a string');
    }

    // Helper to coerce common boolean representations. Returns null for invalid values.
    const parseBoolean = (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
        return null;
      }
      if (typeof v === 'number') {
        if (v === 1) return true;
        if (v === 0) return false;
        return null;
      }
      return null;
    };

    // enabled: global ON/OFF switch for the bot
    if (typeof body.enabled !== 'undefined') {
      const en = parseBoolean(body.enabled);
      if (en === null) errors.push('enabled must be a boolean');
      else cleaned.enabled = en;
    }

    // databaseBackup: boolean; default to false when missing
    if (typeof body.databaseBackup !== 'undefined') {
      const dbb = parseBoolean(body.databaseBackup);
      if (dbb === null) errors.push('databaseBackup must be a boolean');
      else cleaned.databaseBackup = dbb;
    } else {
      cleaned.databaseBackup = false;
    }

    // loginNotification: boolean; default to false when missing
    if (typeof body.loginNotification !== 'undefined') {
      const ln = parseBoolean(body.loginNotification);
      if (ln === null) errors.push('loginNotification must be a boolean');
      else cleaned.loginNotification = ln;
    } else {
      cleaned.loginNotification = false;
    }
    // Optional: settings reload interval (seconds) for the bot process
    if (typeof body.settings_reload_seconds !== 'undefined') {
      const n = Number(body.settings_reload_seconds);
      if (!Number.isFinite(n) || n <= 0) errors.push('settings_reload_seconds must be a positive number');
      else cleaned.settings_reload_seconds = Math.round(n);
    }
  } else if (key === 'remoteServer') {
    const host = typeof body.host === 'string' && body.host.trim() ? body.host.trim() : null;
    const port = Number(body.port);
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : null;
    const authMethod = (typeof body.authMethod === 'string' ? body.authMethod : '').toLowerCase();
    if (!host) errors.push('host is required');
    if (!Number.isFinite(port) || port < 1 || port > 65535) errors.push('port must be 1-65535');
    if (!username) errors.push('username is required');
    if (!['password', 'key'].includes(authMethod)) errors.push("authMethod must be 'password' or 'key'");
    cleaned.host = host;
    cleaned.port = Number.isFinite(port) ? port : 22;
    cleaned.username = username;
    cleaned.authMethod = authMethod || 'password';
    if (cleaned.authMethod === 'password') {
      if (typeof body.password !== 'string' || !body.password) errors.push('password is required for password auth');
      else cleaned.password = body.password;
    } else {
      if (typeof body.privateKey !== 'string' || !body.privateKey) errors.push('privateKey is required for key auth');
      else cleaned.privateKey = body.privateKey;
      if (typeof body.passphrase === 'string' && body.passphrase) cleaned.passphrase = body.passphrase;
    }
  } else if (key === 'general') {
    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (t.length > 0) cleaned.title = t;
    }
    // Only set theme when provided; do not force default 'system' on partial updates
    if (typeof body.theme !== 'undefined') {
      const themeRaw = typeof body.theme === 'string' ? body.theme.trim().toLowerCase() : '';
      const allowedThemes = ['system', 'dark', 'light'];
      if (allowedThemes.includes(themeRaw)) cleaned.theme = themeRaw;
      else if (themeRaw) errors.push("theme must be 'system', 'dark', or 'light'");
    }
    // Only set showTooltips when provided; do not coerce missing field to false
    if (typeof body.showTooltips !== 'undefined') cleaned.showTooltips = !!body.showTooltips;

  // Accept either integer-cent fields (preferred) or decimal price fields from clients.
  // If *_cents is present, validate it as a non-negative integer and use it. Otherwise fall back
  // to the decimal *price fields and convert to cents.
  const parseNonNegInt = (v) => {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : NaN;
    }
    return undefined;
  };

  // price_mini
  const pmCents = parseNonNegInt(body.price_mini_cents);
  if (Number.isFinite(pmCents)) {
    cleaned.price_mini_cents = pmCents;
  } else {
    const pm = parseNonNeg(body.price_mini);
    if (Number.isFinite(pm)) cleaned.price_mini_cents = Math.round(pm * 100);
    else if (typeof body.price_mini !== 'undefined' && !(body.price_mini === null)) errors.push('price_mini must be a non-negative number');
    // If user supplied explicit cents but invalid (e.g., negative or non-integer), add error
    if (typeof body.price_mini_cents !== 'undefined' && !Number.isFinite(pmCents)) errors.push('price_mini_cents must be a non-negative integer');
  }

  // price_basic
  const pbCents = parseNonNegInt(body.price_basic_cents);
  if (Number.isFinite(pbCents)) {
    cleaned.price_basic_cents = pbCents;
  } else {
    const pb = parseNonNeg(body.price_basic);
    if (Number.isFinite(pb)) cleaned.price_basic_cents = Math.round(pb * 100);
    else if (typeof body.price_basic !== 'undefined' && !(body.price_basic === null)) errors.push('price_basic must be a non-negative number');
    if (typeof body.price_basic_cents !== 'undefined' && !Number.isFinite(pbCents)) errors.push('price_basic_cents must be a non-negative integer');
  }

  // price_unlimited
  const puCents = parseNonNegInt(body.price_unlimited_cents);
  if (Number.isFinite(puCents)) {
    cleaned.price_unlimited_cents = puCents;
  } else {
    const pu = parseNonNeg(body.price_unlimited);
    if (Number.isFinite(pu)) cleaned.price_unlimited_cents = Math.round(pu * 100);
    else if (typeof body.price_unlimited !== 'undefined' && !(body.price_unlimited === null)) errors.push('price_unlimited must be a non-negative number');
    if (typeof body.price_unlimited_cents !== 'undefined' && !Number.isFinite(puCents)) errors.push('price_unlimited_cents must be a non-negative integer');
  }
    if (typeof body.currency === 'string' && body.currency.trim().length > 0) {
      cleaned.currency = body.currency.trim().toUpperCase();
    } else if (typeof body.currency !== 'undefined' && body.currency !== null) {
      errors.push('currency must be a non-empty string');
    }
    // Timezone support: accept 'auto' (browser) or a valid IANA time zone string.
    if (typeof body.timezone !== 'undefined') {
      // allow null/empty/'auto' to mean auto/browser timezone
      if (body.timezone === null || body.timezone === '' || body.timezone === 'auto') {
        cleaned.timezone = null;
      } else if (typeof body.timezone === 'string') {
        const tz = body.timezone.trim();
        try {
          // Try to construct an Intl.DateTimeFormat with the given timeZone; will throw on invalid TZ
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          cleaned.timezone = tz;
        } catch (e) {
          errors.push('timezone must be an IANA time zone identifier or "auto"');
        }
      } else {
        errors.push('timezone must be a string or null');
      }
    }
  } else {
    errors.push('Unknown settings category');
  }
  return { ok: errors.length === 0, errors, cleaned };
}

module.exports = { validateSettings };
