Write-Host 'Installing dependencies (if missing) and starting PM2-managed bot...'
Write-Host 'Starting pm2 process...'
& npx pm2 start pm2.config.js --env production
Write-Host 'Saving pm2 process list...'
& npx pm2 save
Write-Host 'pm2 list:'
& npx pm2 list
Write-Host "To view logs: npx pm2 logs cmp-telegram-bot"
