# permes

Languages: English | [日本語](./日本語README.md) | [简体中文](./README.zh-CN.md)

![permes architecture](./assets/pi-hermes-hero.webp)

Experimental Hermes CLI bridge extension for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent).

This extension lets pi delegate a prompt to [Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI in the background, then brings the result back into pi for autonomous review. Supports Grok, Claude, GLM, and any model available in Hermes.

> **Target platform:** Windows 11 (native). This extension is developed and tested on Windows 11. Linux, macOS, and WSL2 may work but are not actively tested.

## Quick Start

1. **Install Hermes Agent CLI** — follow the [official guide](https://github.com/nousresearch/hermes-agent#installation) for your platform.
2. **Verify the CLI** — run `hermes --version` in your terminal. You should see a version number.
3. **Install this extension** (see [Install](#install) below).
4. **Reload pi** — type `/reload` in pi, then use `/permes hello` to test.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) | latest | The agent this extension plugs into |
| [Hermes Agent CLI](https://github.com/nousresearch/hermes-agent) | ≥ 0.14 | Provides `hermes` command |
| Node.js | ≥ 18 | pi itself requires this |

Hermes Agent must be configured with at least one provider (e.g. `xai-oauth`). Run `hermes auth` if you haven't already.

## Install

```bash
# Create the runtime directory (stores model cache, etc.)
mkdir -p ~/.pi/agent/extensions/permes-bin

# Copy the extension file
cp permes.ts ~/.pi/agent/extensions/permes.ts
```

Then reload pi with `/reload`. You should see the extension load in the status bar.

> **Windows users:** `~` expands to `C:\Users\<you>`. The commands above work in Git Bash, PowerShell, or cmd. Make sure `hermes.exe` is in your PATH — it's typically at `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`.

## Usage

```
/permes <message>                    # Ask with previously used model
/permes -m grok-4.3 <message>        # Specify model
/permes -p xai-oauth <message>       # Specify provider
/permes --tui <message>              # Live TUI mode (Linux only)
/permes --tui-wezterm-beta <message> # Experimental WezTerm TUI (any OS)
/permes --status                     # List running tasks
/permes --result <id>                # Get completed task result
/permes --cancel <id>                # Cancel a running task
/permes --reset-model                # Clear model cache
```

- Default model on first use: `grok-4.3`
- The last used `-m` / `-p` values are cached for subsequent calls
- Tasks run in the background — pi stays responsive while Hermes thinks
- Use `--tui` (Linux only) or `--tui-wezterm-beta` (experimental, any OS with WezTerm) to watch the conversation live in a split pane

### Example workflow

```
you: /permes -m grok-4.3 Explain quantum entanglement in 3 bullet points

# pi notifies: → Permes task abc123 started (grok-4.3): Explain quantum entanglement...

# ...after a few seconds, Hermes responds. pi reviews it autonomously.
# If pi finds an error, it sends feedback via permes-review (up to 3 rounds).
# If everything looks good, pi synthesizes the answer silently.
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `hermes: command not found` | Hermes CLI not in PATH | Install Hermes Agent, or add its `bin` to PATH |
| Extension doesn't load after `/reload` | File in wrong location | Check `~/.pi/agent/extensions/permes.ts` exists |
| Task fails with timeout | Hermes CLI hung or model unavailable | Try `hermes chat -q "test" -m grok-4.3` directly in terminal |
| `permes-review` says "Task not found" | Wrong taskId or task expired | Use `/permes --status` to find the correct task ID |
| Model not found error | Model name typo or unavailable | Run `hermes --help` to list available models |

## Architecture

### CLI mode (default)

```
/permes <message>
  │
  ├─ hermes chat -q -Q "msg" -m model --provider provider
  │   └─ Parse session ID + response from CLI output
  │
  ├─ pi reviews response autonomously
  │   ├─ OK → done
  │   └─ Error → permes-review tool
  │       └─ hermes -z "feedback" --resume <session_id>
  │
  └─ Max 3 review rounds, then escalate to user
```

### TUI mode (`--tui`) — Linux only

Requires WezTerm. Spawns hermes chat in a split pane and polls the session
file until completion.

```
/permes --tui <message>
  │
  ├─ Spawn hermes chat in WezTerm split pane
  │
  ├─ Poll session file until stable (8s no change)
  │
  ├─ Read last assistant message from session JSON
  │
  └─ Inject result to pi (same review loop as CLI mode)
```

### WezTerm beta mode (`--tui-wezterm-beta`) — experimental

Works on any OS where WezTerm is installed and `wezterm cli` is available.
Same session file polling as `--tui`, but without the Linux-only restriction.
On Windows, run this inside WezTerm (not Windows Terminal).

```
/permes --tui-wezterm-beta <message>
```

On unsupported platforms, both TUI modes exit with a warning.

Single file: `permes.ts` — no build step. Assumes pi's bundled extension runtime dependencies (including `typebox`).

## Documentation

- [日本語README](./日本語README.md) — Japanese documentation
- [简体中文README](./README.zh-CN.md) — Simplified Chinese documentation

## License

MIT
