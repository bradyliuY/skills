#!/usr/bin/env node
// 用法: node sync.js [progress.json路径]
// 行为: 把 feishu_synced=false 的条目推到飞书；新条目自动 create 并回写 record_id
const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const dataFile = path.resolve(process.argv[2] || 'docs/progress.json')

if (!fs.existsSync(dataFile)) {
  console.error(`✗ 找不到 ${dataFile}`)
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
const TOKEN = data._meta?.feishu_bitable_token
const TABLE = data._meta?.feishu_table_id

if (!TOKEN || !TABLE) {
  console.error('✗ progress.json._meta 缺少 feishu_bitable_token 或 feishu_table_id')
  process.exit(1)
}

const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${TOKEN}/tables/${TABLE}`
const today = new Date().toISOString().slice(0, 10)

const updates = []
const creates = []
data.modules.forEach(m => m.features.forEach(f => {
  if (f.feishu_synced) return
  const fields = { "状态": f.status, "完成度": f.progress, "备注": f.note || '' }
  if (f.feishu_record_id) {
    updates.push({ ref: f, payload: { record_id: f.feishu_record_id, fields } })
  } else {
    creates.push({
      ref: f,
      payload: { fields: { "模块名称": m.module, "功能": f.name, "优先级": f.priority, ...fields } }
    })
  }
}))

if (!updates.length && !creates.length) {
  console.log('✓ 全部已同步')
  process.exit(0)
}

function callLark(url, body) {
  const fname = `lark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  const fpath = path.join(os.tmpdir(), fname)
  fs.writeFileSync(fpath, JSON.stringify(body)) // Node 默认 UTF-8 无 BOM
  try {
    const out = execSync(`lark-cli api POST "${url}" --data "@./${fname}"`, {
      cwd: os.tmpdir(),
      env: { ...process.env, LARK_CLI_NO_PROXY: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const resp = JSON.parse(out.toString())
    if (resp.code !== 0) throw new Error(`飞书 API 错误: ${resp.msg || JSON.stringify(resp)}`)
    return resp
  } finally {
    try { fs.unlinkSync(fpath) } catch {}
  }
}

function batchExec(items, url, onResp) {
  for (let i = 0; i < items.length; i += 500) {
    const batch = items.slice(i, i + 500)
    const resp = callLark(url, { records: batch.map(x => x.payload) })
    onResp(batch, resp)
    batch.forEach(x => { x.ref.feishu_synced = true; x.ref.synced_at = today })
  }
}

if (updates.length) {
  console.log(`→ batch_update ${updates.length} 条`)
  batchExec(updates, `${baseUrl}/records/batch_update`, () => {})
}

if (creates.length) {
  console.log(`→ batch_create ${creates.length} 条`)
  batchExec(creates, `${baseUrl}/records/batch_create`, (batch, resp) => {
    resp.data.records.forEach((rec, idx) => { batch[idx].ref.feishu_record_id = rec.record_id })
  })
}

fs.writeFileSync(dataFile, JSON.stringify(data, null, 2) + '\n')
console.log(`✓ 已同步并回写 ${dataFile}`)
