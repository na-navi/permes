#!/usr/bin/env python3
"""
QA script for Hermes image generation setup.

Diagnoses the current state of image generation capabilities and reports
what's missing or misconfigured. Does NOT modify anything — read-only.

Auth detection:
  1. xAI OAuth (browser auth) → auth.json providers["xai-oauth"]
  2. XAI_API_KEY (env / .env file)
  3. Neither → guide the user to choose
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional

# --- Paths ---

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
AUTH_FILE = Path(os.environ.get("HERMES_AUTH_FILE", HERMES_HOME / "auth.json"))
ENV_FILE = HERMES_HOME / ".env"
CONFIG_FILE = HERMES_HOME / "config.yaml"
HERMES_AGENT_DIR = Path(
    os.environ.get("HERMES_AGENT_DIR",
                   Path.home() / "AppData" / "Local" / "hermes" / "hermes-agent")
)

# Colors (disabled if not a tty)
if sys.stdout.isatty():
    C = {
        "green": "\033[92m", "yellow": "\033[93m", "red": "\033[91m",
        "cyan": "\033[96m", "bold": "\033[1m", "reset": "\033[0m",
    }
else:
    C = {k: "" for k in ("green", "yellow", "red", "cyan", "bold", "reset")}


def _c(color: str, text: str) -> str:
    return f"{C[color]}{text}{C['reset']}"


def _check(icon: str, msg: str, ok: bool, detail: str = ""):
    status = _c("green", "✓") if ok else _c("red", "✗")
    line = f"  {status} {icon} {msg}"
    if detail:
        line += f"  ({detail})"
    print(line)


# --- Auth detection ---

def detect_oauth() -> Optional[dict]:
    """Check if xAI OAuth (browser auth) is configured in auth.json."""
    if not AUTH_FILE.exists():
        return None
    try:
        data = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
        tokens = data.get("providers", {}).get("xai-oauth", {}).get("tokens", {})
        at = tokens.get("access_token", "")
        if at and len(at) > 20:
            return {
                "method": "xAI OAuth (browser auth)",
                "provider": "xai-oauth",
                "token_prefix": at[:20] + "...",
                "token_length": len(at),
                "file": str(AUTH_FILE),
            }
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    return None


def detect_api_key() -> Optional[dict]:
    """Check if XAI_API_KEY is set in .env or environment."""
    key = None
    source = None

    # Check .env file
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("XAI_API_KEY="):
                key = stripped.split("=", 1)[1].strip().strip('"').strip("'")
                source = f".env ({ENV_FILE})"
                break

    # Check environment variable (overrides .env)
    env_key = os.environ.get("XAI_API_KEY", "").strip()
    if env_key:
        key = env_key
        source = "environment variable"

    if key and len(key) > 5:
        return {
            "method": "API Key",
            "provider": "xai",
            "key_prefix": key[:8] + "...",
            "key_length": len(key),
            "source": source,
        }
    return None


# --- Plugin status ---

def detect_plugin_status() -> dict:
    """Check if image_gen/xai and video_gen/xai plugins exist and are enabled."""
    results = {}

    for plugin_name in ("image_gen/xai", "video_gen/xai"):
        plugin_dir = HERMES_AGENT_DIR / "plugins" / plugin_name.replace("/", os.sep)
        yaml_path = plugin_dir / "plugin.yaml"

        exists = yaml_path.exists()
        enabled = False
        version = "?"

        if exists:
            try:
                content = yaml_path.read_text(encoding="utf-8")
                for line in content.splitlines():
                    if line.startswith("version:"):
                        version = line.split(":", 1)[1].strip()
            except Exception:
                pass

        # Check enabled status from config.yaml
        enabled_path = HERMES_HOME / "config.yaml"
        if enabled_path.exists() and exists:
            try:
                import yaml as _yaml
                _cfg = _yaml.safe_load(enabled_path.read_text(encoding="utf-8"))
                _enabled_list = (_cfg or {}).get("plugins", {}).get("enabled", [])
                enabled = plugin_name in _enabled_list
            except Exception:
                pass

        results[plugin_name] = {
            "exists": exists,
            "enabled": enabled,  # best-effort
            "version": version,
            "yaml": str(yaml_path),
        }

    return results


def detect_toolset_status() -> dict:
    """Check image_gen and video_gen toolset status (enabled/disabled)."""
    results = {}
    config_path = HERMES_HOME / "config.yaml"
    if config_path.exists():
        try:
            content = config_path.read_text(encoding="utf-8")
            # Look for toolset enable/disable patterns
            for ts in ("image_gen", "video_gen"):
                # Default is enabled for image_gen, disabled for video_gen
                results[ts] = {
                    "toolset": ts,
                    # We can't reliably parse YAML here without a lib,
                    # so just note it exists
                }
        except Exception:
            pass
    return results


# --- Main ---

def main():
    print()
    print(_c("bold", "═══ Hermes Image Generation QA ═══"))
    print()

    # 1. Auth detection
    print(_c("cyan", "▸ Authentication"))
    print()

    oauth = detect_oauth()
    api_key = detect_api_key()

    has_any_auth = False

    if oauth:
        _check("🔑", f"xAI OAuth detected: {oauth['method']}", True,
               f"token={oauth['token_prefix']} ({oauth['token_length']} chars)")
        has_any_auth = True
    else:
        _check("🔑", "xAI OAuth not found", False)

    if api_key:
        _check("🗝️", f"API Key detected: {api_key['method']}", True,
               f"prefix={api_key['key_prefix']} via {api_key['source']}")
        has_any_auth = True
    else:
        _check("🗝️", "XAI_API_KEY not set", False)

    print()

    if not has_any_auth:
        print(_c("red", "  ⚠ No xAI credentials found. Choose one:"))
        print()
        print(f"    {_c('yellow', 'Option A: Browser auth (recommended)')}")
        print(f"      hermes model    → select xAI Grok OAuth")
        print()
        print(f"    {_c('yellow', 'Option B: API key')}")
        print(f"      Get a key from https://console.x.ai/")
        print(f"      Then: hermes config set XAI_API_KEY <your-key>")
        print(f"      Or add XAI_API_KEY=... to {ENV_FILE}")
        print()
        print("  Re-run this script after setting up auth.")
        print()

    # 2. Plugin status
    print(_c("cyan", "▸ Plugins"))
    print()

    plugins = detect_plugin_status()
    for name, info in plugins.items():
        if info["enabled"]:
            detail = "enabled"
        elif info["exists"]:
            detail = "installed (not enabled)"
        else:
            detail = "NOT FOUND"
        _check("🔌", f"{name} (v{info['version']})", info["enabled"], detail)
        if info["exists"] and not info["enabled"]:
            print(f"      → Enable: hermes plugins enable {name}")

    print()

    # 3. Toolset status
    print(_c("cyan", "▸ Toolsets"))
    print()
    print(f"  Run this to check & enable:")
    print(f"    hermes tools list          # see current status")
    print(f"    hermes tools enable image_gen   # enable image gen")
    print(f"    hermes tools enable video_gen   # enable video gen")
    print()

    # 4. End-to-end test (dry run — no actual API call)
    print(_c("cyan", "▸ Readiness Summary"))
    print()

    plugin_ok = plugins.get("image_gen/xai", {}).get("exists", False)

    if has_any_auth and plugin_ok:
        print(_c("green", "  ✅ Looks good! Try generating an image:"))
        print()
        print(f"    hermes -z \"猫の侍を墨絵スタイルで描いて\"")
        print()
        if not oauth:
            print(_c("yellow", "  💡 Tip: You're using an API key. Consider switching to OAuth"))
            print(_c("yellow", "     (browser auth) for a smoother experience: hermes model"))
            print()
    elif has_any_auth and not plugin_ok:
        print(_c("yellow", "  ⚠ Auth is set but the image_gen/xai plugin is not installed."))
        print(_c("yellow", "    Enable it with: hermes plugins enable image_gen/xai"))
        print()
    elif not has_any_auth and plugin_ok:
        print(_c("yellow", "  ⚠ Plugin is installed but no credentials configured."))
        print(_c("yellow", "    See auth options above."))
        print()
    else:
        print(_c("red", "  ✗ Both auth and plugin need setup. See instructions above."))
        print()

    # 5. Also check video_gen
    video_plugin = plugins.get("video_gen/xai", {})
    if video_plugin.get("exists") and not video_plugin.get("enabled"):
        print(f"  {_c('cyan', 'ℹ')} video_gen/xai plugin is also available.")
        print(f"    Enable: hermes plugins enable video_gen/xai")
        print(f"    Then:   hermes tools enable video_gen")
        print()
    elif video_plugin.get("enabled"):
        print(f"  {_c('green', 'ℹ')} video_gen/xai is also enabled — you can generate videos too!")
        print()

    print(_c("bold", "═══════════════════════════════════"))
    print()


if __name__ == "__main__":
    main()
