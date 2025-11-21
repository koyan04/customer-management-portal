#!/usr/bin/env node
/*
  Checks certificate expiry for a given domain using openssl.
  Usage:
    node scripts/check_cert_expiry.js example.com [--warn=30] [--critical=10]
      [--slack-webhook=https://hooks.slack.com/services/...] 
      [--telegram-bot-token=XXXX] [--telegram-chat-id=12345]
  Environment alternatives (if flags not provided):
    CERT_EXPIRY_WARN_DAYS, CERT_EXPIRY_CRITICAL_DAYS
    CERT_EXPIRY_SLACK_WEBHOOK
    CERT_EXPIRY_TELEGRAM_BOT_TOKEN, CERT_EXPIRY_TELEGRAM_CHAT_ID
  Exits:
    0 if days remaining >= warn
    1 if warn > days >= critical (warning)
    2 if days < critical or error (critical)
*/
const { execSync } = require('child_process');
const axios = require('axios');

function parseArgs() {
  const argv = process.argv.slice(2);
  if (!argv[0]) {
    console.error('Usage: node scripts/check_cert_expiry.js <domain> [--warn=30] [--critical=10]');
    process.exit(2);
  }
  const domain = argv[0];
  let warn = Number(process.env.CERT_EXPIRY_WARN_DAYS || 30);
  let critical = Number(process.env.CERT_EXPIRY_CRITICAL_DAYS || 10);
  let slackWebhook = process.env.CERT_EXPIRY_SLACK_WEBHOOK || '';
  let tgBotToken = process.env.CERT_EXPIRY_TELEGRAM_BOT_TOKEN || '';
  let tgChatId = process.env.CERT_EXPIRY_TELEGRAM_CHAT_ID || '';
  for (const a of argv.slice(1)) {
    if (a.startsWith('--warn=')) warn = Number(a.split('=')[1]) || warn;
    if (a.startsWith('--critical=')) critical = Number(a.split('=')[1]) || critical;
    if (a.startsWith('--slack-webhook=')) slackWebhook = a.split('=')[1] || slackWebhook;
    if (a.startsWith('--telegram-bot-token=')) tgBotToken = a.split('=')[1] || tgBotToken;
    if (a.startsWith('--telegram-chat-id=')) tgChatId = a.split('=')[1] || tgChatId;
  }
  return { domain, warn, critical, slackWebhook, tgBotToken, tgChatId };
}

function getExpiryTs(domain) {
  try {
    const notAfter = execSync(`openssl s_client -servername ${domain} -connect ${domain}:443 < /dev/null 2>/dev/null | openssl x509 -noout -enddate`).toString().trim();
    // notAfter=Nov  5 12:34:56 2026 GMT
    const s = (notAfter.split('=')[1] || '').trim();
    const ts = Date.parse(s + ' UTC');
    if (!Number.isFinite(ts)) throw new Error('Failed to parse date: ' + s);
    return ts;
  } catch (e) {
    console.error('Failed to query certificate:', e.message || e);
    process.exit(2);
  }
}

async function notifySlack(webhook, text) {
  if (!webhook) return;
  try { await axios.post(webhook, { text }); } catch (_) {}
}

async function notifyTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try { await axios.post(url, { chat_id: chatId, text }); } catch (_) {}
}

async function main() {
  const { domain, warn, critical, slackWebhook, tgBotToken, tgChatId } = parseArgs();
  const now = Date.now();
  const expTs = getExpiryTs(domain);
  const days = Math.floor((expTs - now) / (1000 * 60 * 60 * 24));
  const payload = { domain, daysRemaining: days, ts: now };
  if (days < critical) {
    const msg = `[CRITICAL] TLS certificate for ${domain} expires in ${days} day(s)`;
    console.error(msg, payload);
    await Promise.all([
      notifySlack(slackWebhook, msg),
      notifyTelegram(tgBotToken, tgChatId, msg)
    ]);
    process.exit(2);
  } else if (days < warn) {
    const msg = `[WARN] TLS certificate for ${domain} expires in ${days} day(s)`;
    console.warn(msg, payload);
    await Promise.all([
      notifySlack(slackWebhook, msg),
      notifyTelegram(tgBotToken, tgChatId, msg)
    ]);
    process.exit(1);
  } else {
    console.log('[OK] cert valid', payload);
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}
