# pi-hermes

Hermes CLI extension for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent).

Use the `/hermes` command to ask any model available in [Hermes Agent](https://github.com/nousresearch/hermes-agent) — Grok, Claude, GLM, and more — without leaving pi. Responses are reviewed autonomously and corrections are applied in a loop.

> **Target platform:** Windows 11 (native). This extension is developed and tested on Windows 11. Linux, macOS, and WSL2 may work but are not actively tested.

## Quick Start

1. **Install Hermes Agent CLI** — follow the [official guide](https://github.com/nousresearch/hermes-agent#installation) for your platform.
2. **Verify the CLI** — run `hermes --version` in your terminal. You should see a version number.
3. **Install this extension** (see [Install](#install) below).
4. **Reload pi** — type `/reload` in pi, then use `/hermes hello` to test.

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
mkdir -p ~/.pi/agent/extensions/hermes-bin

# Copy the extension file
cp hermes.ts ~/.pi/agent/extensions/hermes.ts
```

Then reload pi with `/reload`. You should see the extension load in the status bar.

> **Windows users:** `~` expands to `C:\Users\<you>`. The commands above work in Git Bash, PowerShell, or cmd. Make sure `hermes.exe` is in your PATH — it's typically at `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`.

## Usage

```
/hermes <message>              # Ask with previously used model
/hermes -m grok-4.3 <message>  # Specify model
/hermes -p xai-oauth <message> # Specify provider
/hermes --status               # List running tasks
/hermes --result <id>          # Get completed task result
/hermes --cancel <id>          # Cancel a running task
/hermes --reset-model          # Clear model cache
```

- Default model on first use: `grok-4.3`
- The last used `-m` / `-p` values are cached for subsequent calls
- Tasks run in the background — pi stays responsive while Hermes thinks

### Example workflow

```
you: /hermes -m grok-4.3 Explain quantum entanglement in 3 bullet points

# pi notifies: → Hermes task abc123 started (grok-4.3): Explain quantum entanglement...

# ...after a few seconds, Hermes responds. pi reviews it autonomously.
# If pi finds an error, it sends feedback via hermes-review (up to 3 rounds).
# If everything looks good, pi synthesizes the answer silently.
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `hermes: command not found` | Hermes CLI not in PATH | Install Hermes Agent, or add its `bin` to PATH |
| Extension doesn't load after `/reload` | File in wrong location | Check `~/.pi/agent/extensions/hermes.ts` exists |
| Task fails with timeout | Hermes CLI hung or model unavailable | Try `hermes chat -q "test" -m grok-4.3` directly in terminal |
| `hermes-review` says "No active session" | Review called without `/hermes` | Start a query with `/hermes` first |
| Model not found error | Model name typo or unavailable | Run `hermes --help` to list available models |

## Architecture

```
/hermes <message>
  │
  ├─ hermes chat -q "msg" -m model --provider provider
  │   └─ Parse session ID + response from CLI output
  │
  ├─ pi reviews response autonomously
  │   ├─ OK → done
  │   └─ Error → hermes-review tool
  │       └─ hermes -z "feedback" --resume <session_id>
  │
  └─ Max 3 review rounds, then escalate to user
```

Single file: `hermes.ts` — no build step, no dependencies beyond pi's extension API.

## Documentation

- [AGENTS.md](./AGENTS.md) — development guidelines and architecture notes (Japanese)
- [日本語README](./日本語README.md) — Japanese documentation

## License

MIT
