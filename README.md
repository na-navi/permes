# pi-hermes

Hermes CLI extension for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent).

Enables `/hermes` command to ask any model available in [Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI, with an autonomous review loop.

## Features

- **Model-agnostic** — Use any Hermes CLI model (`grok-4.3`, `glm-5.1`, `claude-sonnet-4`, etc.)
- **Non-blocking** — pi stays responsive while Hermes thinks in the background
- **Autonomous review** — pi reviews the response and can send feedback via `hermes-review` tool (max 3 rounds)
- **Session continuity** — Review feedback uses `hermes --resume` to maintain conversation context

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

Default model on first use: `grok-4.3`. The last used model is cached for subsequent calls.

## Install

```bash
mkdir -p ~/.pi/agent/extensions/hermes-bin
cp hermes.ts ~/.pi/agent/extensions/hermes.ts
```

Requires [Hermes Agent](https://github.com/nousresearch/hermes-agent) CLI (`hermes`) installed and configured.

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

## License

MIT
