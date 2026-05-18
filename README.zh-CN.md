# permes

语言: 简体中文 | [English](./README.md) | [日本語](./日本語README.md)

![pi-hermes architecture](./assets/pi-hermes-hero.webp)

[pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) 的实验性 Hermes CLI 桥接扩展。

该扩展让 pi 将提示委托给 [Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI 在后台执行，然后将结果带回 pi 进行自主审查。支持 Grok、Claude、GLM 以及 Hermes 中可用的所有模型。

> **目标平台：** Windows 11（原生）。本扩展在 Windows 11 上开发和测试。Linux、macOS 和 WSL2 可能可以运行，但未经过积极测试。

## 快速开始

1. **安装 Hermes Agent CLI** — 按照对应平台的[官方指南](https://github.com/nousresearch/hermes-agent#installation)操作。
2. **验证 CLI** — 在终端中运行 `hermes --version`，应显示版本号。
3. **安装本扩展**（参见下方[安装](#安装)部分）。
4. **重新加载 pi** — 在 pi 中输入 `/reload`，然后使用 `/permes hello` 测试。

## 前置条件

| 条件 | 版本 | 说明 |
|---|---|---|
| [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) | 最新版 | 本扩展所接入的代理 |
| [Hermes Agent CLI](https://github.com/nousresearch/hermes-agent) | ≥ 0.14 | 提供 `hermes` 命令 |
| Node.js | ≥ 18 | pi 本身的要求 |

Hermes Agent 必须配置至少一个提供商（如 `xai-oauth`）。如果尚未配置，请运行 `hermes auth`。

## 安装

```bash
# 创建运行时目录（存储模型缓存等）
mkdir -p ~/.pi/agent/extensions/permes-bin

# 复制扩展文件
cp permes.ts ~/.pi/agent/extensions/permes.ts
```

然后用 `/reload` 重新加载 pi。你应该能在状态栏看到扩展加载。

> **Windows 用户：** `~` 展开为 `C:\Users\<你的用户名>`。上述命令在 Git Bash、PowerShell 或 cmd 中均可运行。确保 `hermes.exe` 在 PATH 中——通常位于 `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`。

## 使用方法

```
/permes <message>                    # 使用上次使用的模型提问
/permes -m grok-4.3 <message>        # 指定模型
/permes -p xai-oauth <message>       # 指定提供商
/permes --tui <message>              # 实时 TUI 模式（仅限 Linux）
/permes --tui-wezterm-beta <message> # 实验性 WezTerm TUI（任意 OS）
/permes --status                     # 列出运行中的任务
/permes --result <id>                # 获取已完成任务的结果
/permes --cancel <id>                # 取消运行中的任务
/permes --reset-model                # 清除模型缓存
```

- 首次使用的默认模型：`grok-4.3`
- 上次使用的 `-m` / `-p` 值会被缓存，供后续调用使用
- 任务在后台运行——Hermes 思考时 pi 保持响应
- 使用 `--tui`（仅限 Linux）或 `--tui-wezterm-beta`（实验性，装有 WezTerm 的任意 OS）在分屏中实时观看

### 示例工作流

```
you: /permes -m grok-4.3 用3个要点解释量子纠缠

# pi 通知: → Permes task abc123 started (grok-4.3): 用3个要点解释量子纠缠...

# ...几秒后，Hermes 响应。pi 自主审查结果。
# 如果 pi 发现错误，会通过 permes-review 发送反馈（最多 3 轮）。
# 如果一切正常，pi 静默综合答案。
```

## 故障排除

| 问题 | 原因 | 解决方法 |
|---|---|---|
| `hermes: command not found` | Hermes CLI 不在 PATH 中 | 安装 Hermes Agent，或将其 `bin` 目录添加到 PATH |
| `/reload` 后扩展未加载 | 文件位置错误 | 检查 `~/.pi/agent/extensions/permes.ts` 是否存在 |
| 任务超时失败 | Hermes CLI 挂起或模型不可用 | 在终端中直接运行 `hermes chat -q "test" -m grok-4.3` |
| `permes-review` 显示 "Task not found" | taskId 错误或任务已过期 | 使用 `/permes --status` 查找正确的任务 ID |
| 找不到模型 | 模型名称拼写错误或不可用 | 运行 `hermes --help` 列出可用模型 |

## 架构

### CLI 模式（默认）

```
/permes <message>
  │
  ├─ hermes chat -q -Q "msg" -m model --provider provider
  │   └─ 从 CLI 输出中解析 session ID 和响应
  │
  ├─ pi 自主审查响应
  │   ├─ 正确 → 完成
  │   └─ 错误 → permes-review 工具
  │       └─ hermes -z "feedback" --resume <session_id>
  │
  └─ 最多 3 轮审查，然后上报给用户
```

### TUI 模式（`--tui`）— 仅限 Linux

需要 WezTerm。在分屏中启动 hermes chat，轮询 session 文件直到完成。

```
/permes --tui <message>
  │
  ├─ 在 WezTerm 分屏中启动 hermes chat
  │
  ├─ 轮询 session 文件直到稳定（8 秒无变化）
  │
  ├─ 从 session JSON 中读取最后的助手消息
  │
  └─ 将结果注入 pi（与 CLI 模式相同的审查循环）
```

### WezTerm 测试模式（`--tui-wezterm-beta`）— 实验性

在安装了 WezTerm 且 `wezterm cli` 可用的任何 OS 上工作。
与 `--tui` 相同的 session 文件轮询，但没有 Linux 限制。
在 Windows 上，请在 WezTerm 中运行。

```
/permes --tui-wezterm-beta <message>
```

在不支持的平台上，两种 TUI 模式都会显示警告并退出。

## 文件结构

- `permes.ts — 扩展本体，单文件，无需构建步骤，单文件，无需构建步骤
- `scripts/qa-image-gen.ts` — Hermes 图像生成环境诊断脚本
- `.tools/deploy-hermes.sh` — 自动部署脚本

## 许可证

MIT
