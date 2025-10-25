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
    const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    if (!botToken) errors.push('botToken is required');
    const defaultChatId = typeof body.defaultChatId === 'string' || typeof body.defaultChatId === 'number' ? String(body.defaultChatId).trim() : '';
    if (defaultChatId && !/^[-]?\d+$/.test(defaultChatId)) errors.push('defaultChatId must be numeric');
    cleaned.botToken = botToken;
    if (defaultChatId) cleaned.defaultChatId = defaultChatId;
    if (typeof body.messageTemplate === 'string') cleaned.messageTemplate = body.messageTemplate;
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
    const themeRaw = typeof body.theme === 'string' ? body.theme.trim().toLowerCase() : 'system';
    const allowedThemes = ['system', 'dark', 'light'];
    cleaned.theme = allowedThemes.includes(themeRaw) ? themeRaw : 'system';
    cleaned.showTooltips = !!body.showTooltips;

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
  } else {
    errors.push('Unknown settings category');
  }
  return { ok: errors.length === 0, errors, cleaned };
}

module.exports = { validateSettings };
