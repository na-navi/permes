# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-18

### Added

- Initial pi-coding-agent extension: `/hermes` command + `hermes-review` tool
- Async sub-agent architecture — hermes runs in background, pi stays responsive
- Model/provider caching in `~/.pi/agent/extensions/hermes-bin/.default-model`
- Autonomous review loop (max 3 rounds) via `hermes -z --resume <session_id>`
- Quiet mode (`-Q`) support for reliable session ID and response parsing
- `--tui` mode: spawn hermes chat in split pane (WezTerm / Windows Terminal)
  - Session file polling detects completion automatically
  - Pane count guard: refuses to split if >1 pane exists
  - Reuses existing hermes pane if found
- Auto-deploy post-commit hook (`.tools/deploy-hermes.sh`)
- Image generation QA diagnostic script (`scripts/qa-image-gen.ts`)
- MIT LICENSE

### Fixed

- `deliverAs: "followUp"` added to `sendUserMessage` in async `runTask()` —
  prevents "Agent is already processing" runtime error when task completes
  during streaming (#8)
- Internal review round counter (caller cannot bypass the max-3 limit)
- Safety boundaries for parallel task support (#4)

### Documentation

- English README with install instructions and troubleshooting
- Japanese README (`日本語README.md`)
