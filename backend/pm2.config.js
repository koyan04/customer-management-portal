module.exports = {
  apps: [
    {
      name: 'cmp-telegram-bot',
      script: 'telegram_bot.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
