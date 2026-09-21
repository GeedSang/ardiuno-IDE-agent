$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
if(-not (Test-Path (Join-Path $root 'dist\extension.js'))){ npm run build --prefix $root }
Write-Host "插件已编译。Arduino IDE 2.x 的插件目录需要根据安装渠道配置。"
Write-Host "开发模式可使用 Theia/Arduino IDE 的 --extensionDevelopmentPath=$root"
