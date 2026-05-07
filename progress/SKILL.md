---
name: progress
description: Use when the user mentions feature status, progress, or Feishu sync. Triggers on phrases like "xxx完成了/进行中/暂停", "新增功能/加需求", "同步飞书", "看进度/生成报告". Manages docs/progress.json as local source of truth and syncs to Feishu Bitable. Use proactively when the user reports finishing or starting a feature.
---

# 项目进度管理

## Overview

`docs/progress.json` 是主数据源（含 `_meta` 飞书配置），飞书是镜像。所有写操作走 **本地优先 + 脏标记** 模式：

1. 改本地数据，设 `feishu_synced: false`
2. 跑 `scripts/sync.js` 推到飞书并回写 `record_id` + `feishu_synced: true`

`sync.js` 封装了 PowerShell/lark-cli 调用、UTF-8 无 BOM 文件写入、批次切分（500/批）、分组（update vs create）等所有脏活，跨平台、零配置。

## When to Use

| 用户说 | 分支 |
|-------|------|
| "xxx完成/已交付/做好了" | [Update] → status=已完成, progress=100 |
| "xxx进行中/开发中" | [Update] → status=进行中, progress=50（若原为0）|
| "暂停xxx" | [Update] → status=暂停 |
| "新增 模块>功能" / "加需求" | [Add] |
| "同步" / "同步飞书" | [Sync] |
| "看进度/报告/导出md" | [Report] |
| 提到模块名+状态变化但没明确动词 | [Update] |

## Workflows

### [Update] 更新状态

1. 读 `docs/progress.json`，模糊匹配 `module + name`（用户只说功能名也要能定位）
2. 用 Edit 改字段：`status` / `progress` / `note`，**必须同步设 `feishu_synced: false`**
3. 立即跑 `node .claude/skills/progress/scripts/sync.js`

### [Add] 新增需求

1. 提取：模块名、功能名、优先级（默认 P2 中）、备注
2. 在对应模块 `features` 末尾追加；模块不存在则在 `modules` 末尾新建模块
3. 模板：
   ```json
   { "name": "X", "status": "未开始", "progress": 0, "priority": "P2 中",
     "note": "", "feishu_record_id": null, "feishu_synced": false, "synced_at": null }
   ```
4. 立即跑 sync.js（脚本自动走 batch_create 并回写 record_id）

### [Sync] 同步飞书

```bash
node .claude/skills/progress/scripts/sync.js
```

只推 `feishu_synced: false` 的条目。脚本自动：分组（有/无 record_id）→ 调 lark-cli → 解析返回 → 回写 progress.json。

### [Report] 生成 Markdown 报告

```bash
node .claude/skills/progress/scripts/gen-report.js
```

输出 `docs/progress-report.md`（总览 + 各模块进度条 + 待同步清单）。

### [Overview] 对话内输出

读 `progress.json`，**在对话中**直接输出（不写文件）：模块统计表 + `feishu_synced=false` 清单。

## 数据格式

```json
{
  "_meta": {
    "feishu_bitable_token": "<APP_TOKEN>",
    "feishu_table_id": "<TABLE_ID>"
  },
  "modules": [
    {
      "module": "模块名",
      "features": [
        { "name": "功能名", "status": "未开始|进行中|已完成|暂停",
          "progress": 0-100, "priority": "P0 紧急|P1 高|P2 中|P3 低",
          "note": "...", "feishu_record_id": "rec...|null",
          "feishu_synced": true|false, "synced_at": "YYYY-MM-DD|null" }
      ]
    }
  ]
}
```

**初始化**：如果 `docs/progress.json` 不存在，先创建：
```json
{ "_meta": { "feishu_bitable_token": "<问用户>", "feishu_table_id": "<问用户>" },
  "modules": [] }
```
飞书 token 获取：Bitable URL `vcn0...feishu.cn/wiki/<wikiToken>`，先调 `wiki/v2/spaces/get_node` 拿 `obj_token` 才是 app_token。

## Example：端到端

**用户**："租户分佣的提现审核完成了，备注'通过测试验收'"

**Skill 行为**：

1. 读 `docs/progress.json`，定位到模块"租户分佣" → 功能"提现审核"
2. Edit 三个字段：
   ```diff
   - "status": "进行中", "progress": 85, "note": "新模块待完整测试验收",
   - "feishu_synced": true
   + "status": "已完成", "progress": 100, "note": "通过测试验收",
   + "feishu_synced": false
   ```
3. 跑 `node .claude/skills/progress/scripts/sync.js`
4. 输出：`→ batch_update 1 条 / ✓ 已同步并回写 docs/progress.json`
5. 回报用户：`✅ 提现审核 已标记完成（100%），已同步到飞书`

## Common Mistakes

| 错误 | 后果 | 正确做法 |
|------|------|----------|
| 改本地 JSON 但忘设 `feishu_synced: false` | sync.js 会跳过这条 | 改字段时同步设脏标记 |
| 用 `Write` 工具整文件覆盖 | 容易格式破坏/误改其他条目 | 用 `Edit` 工具精准改 |
| 跳过 sync.js 自己手写 PowerShell | 易踩 BOM/HTTP method/路径坑 | **始终用 sync.js** |
| 飞书状态值拼写不对（如"完成"） | 创建新选项或报错 | 必须：`未开始`/`进行中`/`已完成`/`暂停` |
| token 写在 SKILL.md | 迁移到其他项目失效 | 配在 `progress.json._meta` |

## Migration / 环境准备

### 1. 安装 lark-cli（飞书官方 CLI）

```bash
npm install -g @larksuite/cli
lark-cli --version    # 验证（≥ 1.0.0）
```

### 2. 登录飞书

```bash
lark-cli auth login   # Device Flow 授权（浏览器扫码）
lark-cli auth status  # 验证登录状态
lark-cli doctor       # 健康检查（配置/认证/网络）
```

授权账号必须在目标飞书 Bitable 有读写权限。

### 3. 配置项目

在目标项目 `docs/progress.json` 配 `_meta`：
```json
{ "_meta": {
    "feishu_bitable_token": "<APP_TOKEN>",
    "feishu_table_id": "<TABLE_ID>"
  },
  "modules": [] }
```

**获取 APP_TOKEN**：
- Bitable URL 长这样：`https://xxx.feishu.cn/wiki/<wikiToken>?table=<tableId>`
- Wiki token ≠ Bitable app token，需先调一次：
  ```bash
  lark-cli api GET "https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=<wikiToken>"
  ```
  返回的 `data.node.obj_token` 才是真正的 app_token。

### 4. 复制 skill

把 `.claude/skills/progress/` 整个目录复制到目标项目即可，skill 内文件不需要改。
