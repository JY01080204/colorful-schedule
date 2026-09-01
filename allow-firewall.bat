@echo off
rem 彩色日程：一键放行防火墙 8123 端口（需要管理员，会弹出 UAC 确认）
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $r = netsh advfirewall firewall show rule name='ColorfulSchedule-8123'; if ($LASTEXITCODE -ne 0) { if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0allow-firewall.ps1'; Write-Host '已请求管理员授权，请在弹出的窗口中点击“是”' } else { & '%~dp0allow-firewall.ps1' } } else { Write-Host '防火墙规则已存在，无需设置' } }"
pause
