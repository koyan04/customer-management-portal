Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | ForEach-Object { $_.Kill() }
Start-Process -FilePath 'node' -ArgumentList 'index.js' -WorkingDirectory 'C:\Users\Ko Yan\projects\user-management-portal\backend' -NoNewWindow -RedirectStandardOutput 'server_out.log' -RedirectStandardError 'server_err.log'
Start-Sleep -Seconds 1
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | Select-Object Id,ProcessName | Format-List
