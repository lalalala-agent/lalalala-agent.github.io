# 一键构建并发布 PKB 知识库到 GitHub Pages
# 用法：在 E:\work\pkb 目录下执行  .\update-site.ps1
# 流程：构建站点 -> 同步产物 -> 提交 -> 推送，网站约 1~2 分钟后自动更新
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '==> 1/4 构建站点...'
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败，请检查报错' }

Write-Host '==> 2/4 同步构建产物到站点根目录...'
Copy-Item -Path ".\dist\*" -Destination "." -Recurse -Force

Write-Host '==> 3/4 提交变更...'
git add -A
git commit -m "更新知识库 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
if ($LASTEXITCODE -ne 0) { Write-Host '没有新变更需要提交，继续推送' }

Write-Host '==> 4/4 推送到 GitHub...'
git push
if ($LASTEXITCODE -ne 0) { throw '推送失败，请检查网络或登录状态' }

Write-Host ''
Write-Host '完成！网站约 1~2 分钟后自动更新：'
Write-Host 'https://lalalala-agent.github.io/'
