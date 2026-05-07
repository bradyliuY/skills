#!/usr/bin/env node
// 用法: node gen-report.js [progress.json路径] [输出md路径]
// 默认: docs/progress.json -> docs/progress-report.md（相对当前工作目录）
const fs = require('fs')
const path = require('path')

const dataFile = path.resolve(process.argv[2] || 'docs/progress.json')
const outFile = path.resolve(process.argv[3] || 'docs/progress-report.md')

if (!fs.existsSync(dataFile)) {
  console.error(`✗ 找不到 ${dataFile}`)
  process.exit(1)
}

const { modules } = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
const emoji = { '已完成': '✅', '进行中': '🔄', '暂停': '⏸', '未开始': '⭕' }
const bar = avg => '█'.repeat(Math.round(avg / 10)) + '░'.repeat(10 - Math.round(avg / 10))

const total = { '已完成': 0, '进行中': 0, '未开始': 0, '暂停': 0 }
const unsynced = []
modules.forEach(m => m.features.forEach(f => {
  total[f.status] = (total[f.status] || 0) + 1
  if (!f.feishu_synced) unsynced.push({ module: m.module, ...f })
}))
const totalCount = Object.values(total).reduce((a, b) => a + b, 0)

const lines = [
  `# 项目进度报告`,
  `> 生成时间：${new Date().toISOString().slice(0, 10)}\n`,
  `## 总览\n`,
  `| 状态 | 数量 | 占比 |`,
  `|------|------|------|`,
  ...Object.entries(total).map(([s, n]) =>
    `| ${emoji[s]} ${s} | ${n} | ${totalCount ? Math.round(n / totalCount * 100) : 0}% |`),
  '',
  `## 模块详情\n`
]

modules.forEach(m => {
  if (!m.features.length) return
  const avg = Math.round(m.features.reduce((s, f) => s + f.progress, 0) / m.features.length)
  lines.push(`### ${m.module}  ${bar(avg)} ${avg}%\n`)
  lines.push(`| 功能 | 状态 | 完成度 | 备注 |`)
  lines.push(`|------|------|--------|------|`)
  m.features.forEach(f => {
    lines.push(`| ${f.name} | ${emoji[f.status] || ''} ${f.status} | ${f.progress}% | ${f.note || ''} |`)
  })
  lines.push('')
})

if (unsynced.length) {
  lines.push(`## 待同步到飞书 (${unsynced.length} 条)\n`)
  lines.push(`| 模块 | 功能 | 状态 | 完成度 |`)
  lines.push(`|------|------|------|--------|`)
  unsynced.forEach(f => {
    lines.push(`| ${f.module} | ${f.name} | ${emoji[f.status] || ''} ${f.status} | ${f.progress}% |`)
  })
} else {
  lines.push(`## 待同步到飞书\n\n> 全部已同步 ✅`)
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8')
console.log(`✓ ${outFile}`)
