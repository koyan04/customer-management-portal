const { validateSettings } = require('../lib/validateSettings');

describe('validateSettings - telegram', () => {
  test('accepts a full valid payload', () => {
    const body = {
      botToken: '123:ABC',
      defaultChatId: '12345',
      notificationTime: '@daily',
      databaseBackup: 'true',
      loginNotification: 0,
      messageTemplate: 'hi',
    };
    const res = validateSettings('telegram', body);
    expect(res.ok).toBe(true);
    expect(res.cleaned.botToken).toBe('123:ABC');
    expect(res.cleaned.defaultChatId).toBe('12345');
    expect(res.cleaned.notificationTime).toBe('@daily');
    expect(res.cleaned.databaseBackup).toBe(true);
    expect(res.cleaned.loginNotification).toBe(false);
    expect(res.cleaned.messageTemplate).toBe('hi');
  });

  test('botToken empty string produces error when present', () => {
    const body = { botToken: '   ' };
    const res = validateSettings('telegram', body);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(expect.arrayContaining(['botToken is required']));
  });

  test('defaultChatId must be numeric', () => {
    const body = { defaultChatId: 'abc' };
    const res = validateSettings('telegram', body);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(expect.arrayContaining(['defaultChatId must be numeric']));
  });

  test('invalid boolean for loginNotification results in error', () => {
    const body = { loginNotification: 'maybe' };
    const res = validateSettings('telegram', body);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(expect.arrayContaining(['loginNotification must be a boolean']));
  });

  test('missing optional fields still ok and defaults applied', () => {
    const body = {};
    const res = validateSettings('telegram', body);
    expect(res.ok).toBe(true);
    expect(res.cleaned.databaseBackup).toBe(false);
    expect(res.cleaned.loginNotification).toBe(false);
    expect(res.cleaned.botToken).toBeUndefined();
  });
});
