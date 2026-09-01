# 以管理员身份运行：放行 8123 端口入站
$rule = 'ColorfulSchedule-8123'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '需要管理员权限，正在重新以管理员身份启动…' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', "`"$PSCommandPath`""
    exit
}
$check = netsh advfirewall firewall show rule name=$rule 2>&1
if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=8123
    if ($LASTEXITCODE -eq 0) {
        Write-Host '✔ 防火墙已放行 8123 端口，手机现在可以访问了' -ForegroundColor Green
    } else {
        Write-Host '✘ 添加规则失败' -ForegroundColor Red
    }
} else {
    Write-Host '规则已存在，无需重复添加' -ForegroundColor Green
}
Start-Sleep -Seconds 2
