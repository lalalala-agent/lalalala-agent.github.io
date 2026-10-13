# 一键构建并发布 PKB 知识库到 GitHub Pages
# 用法：改完 笔记/ 里的 Markdown 后，在 E:\work\pkb 目录执行  .\update-site.ps1
# 流程：根据笔记生成网页到 docs/ -> 提交 -> 推送，网站约 1~2 分钟后自动更新
# 仓库 Settings → Pages 的发布目录必须是 /docs
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '==> 1/3 根据笔记构建网页到 docs ...'
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败，请检查报错' }

Write-Host '==> 2/3 提交变更...'
git add -A
git commit -m "更新知识库 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
if ($LASTEXITCODE -ne 0) { Write-Host '没有新变更需要提交，继续推送' }

Write-Host '==> 3/3 推送到 GitHub...'
git push
if ($LASTEXITCODE -ne 0) { throw '推送失败，请检查网络或登录状态' }

Write-Host ''
Write-Host '完成！网站约 1~2 分钟后自动更新：'
Write-Host 'https://lalalala-agent.github.io/'
