/**
 * QA script for Hermes image generation setup.
 *
 * Diagnoses the current state of image generation capabilities and reports
 * what's missing or misconfigured. Does NOT modify anything — read-only.
 *
 * Auth detection:
 *   1. xAI OAuth (browser auth) → auth.json providers["xai-oauth"]
 *   2. XAI_API_KEY (env / .env file)
 *   3. Neither → guide the user to choose
 *
 * Usage:
 *   npx tsx scripts/qa-image-gen.ts
 *   node --experimental-strip-types scripts/qa-image-gen.ts   (Node >= 23)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

// --- Paths ---

const HERMES_HOME =
  process.env.HERMES_HOME ||
  join(homedir(), "AppData", "Local", "hermes");
const AUTH_FILE = process.env.HERMES_AUTH_FILE || join(HERMES_HOME, "auth.json");
const ENV_FILE = join(HERMES_HOME, ".env");
const CONFIG_FILE = join(HERMES_HOME, "config.yaml");
const HERMES_AGENT_DIR =
  process.env.HERMES_AGENT_DIR ||
  join(homedir(), "AppData", "Local", "hermes", "hermes-agent");

// --- Colors (disabled if not a tty) ---

const isTty = process.stdout.isTTY;
const C = isTty
  ? {
      green: "\x1b[92m",
      yellow: "\x1b[93m",
      red: "\x1b[91m",
      cyan: "\x1b[96m",
      bold: "\x1b[1m",
      reset: "\x1b[0m",
    }
  : { green: "", yellow: "", red: "", cyan: "", bold: "", reset: "" };

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`;
}

function check(icon: string, msg: string, ok: boolean, detail = ""): void {
  const status = ok ? c("green", "✓") : c("red", "✗");
  let line = `  ${status} ${icon} ${msg}`;
  if (detail) line += `  (${detail})`;
  console.log(line);
}

// --- Auth detection ---

interface AuthInfo {
  method: string;
  provider: string;
  tokenLength?: number;
  keyLength?: number;
  source?: string;
}

function detectOAuth(): AuthInfo | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    const tokens = data?.providers?.["xai-oauth"]?.tokens;
    const at: string = tokens?.access_token || "";
    if (at && at.length > 20) {
      return {
        method: "xAI OAuth (browser auth)",
        provider: "xai-oauth",
        tokenLength: at.length,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function detectApiKey(): AuthInfo | null {
  let key = "";
  let source = "";

  // Check .env file
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
      const stripped = line.trim();
      if (stripped.startsWith("XAI_API_KEY=")) {
        key = stripped.slice("XAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
        source = `.env (${ENV_FILE})`;
        break;
      }
    }
  }

  // Environment variable overrides .env
  const envKey = (process.env.XAI_API_KEY || "").trim();
  if (envKey) {
    key = envKey;
    source = "environment variable";
  }

  if (key && key.length > 5) {
    return {
      method: "API Key",
      provider: "xai",
      keyLength: key.length,
      source,
    };
  }
  return null;
}

// --- Plugin status ---

interface PluginInfo {
  exists: boolean;
  enabled: boolean;
  version: string;
}

function detectPluginStatus(): Record<string, PluginInfo> {
  const pluginNames = ["image_gen/xai", "video_gen/xai"];
  const results: Record<string, PluginInfo> = {};

  // Read enabled list from config.yaml
  let enabledList: string[] = [];
  if (existsSync(CONFIG_FILE)) {
    try {
      const cfg = yaml.load(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, any>;
      enabledList = cfg?.plugins?.enabled ?? [];
    } catch {
      // ignore
    }
  }

  for (const name of pluginNames) {
    const yamlPath = join(HERMES_AGENT_DIR, "plugins", ...name.split("/"), "plugin.yaml");
    const exists = existsSync(yamlPath);
    let version = "?";

    if (exists) {
      try {
        for (const line of readFileSync(yamlPath, "utf-8").split("\n")) {
          if (line.startsWith("version:")) {
            version = line.split(":").slice(1).join(":").trim();
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    results[name] = {
      exists,
      enabled: enabledList.includes(name),
      version,
    };
  }
  return results;
}

// --- Main ---

function main(): void {
  console.log();
  console.log(c("bold", "═══ Hermes Image Generation QA ═══"));
  console.log();

  // 1. Auth detection
  console.log(c("cyan", "▸ Authentication"));
  console.log();

  const oauth = detectOAuth();
  const apiKey = detectApiKey();
  let hasAnyAuth = false;

  if (oauth) {
    check("🔑", `xAI OAuth detected: ${oauth.method}`, true,
      `token present (${oauth.tokenLength} chars)`);
    hasAnyAuth = true;
  } else {
    check("🔑", "xAI OAuth not found", false);
  }

  if (apiKey) {
    check("🗝️", `API Key detected: ${apiKey.method}`, true,
      `key present (${apiKey.keyLength} chars) via ${apiKey.source}`);
    hasAnyAuth = true;
  } else {
    check("🗝️", "XAI_API_KEY not set", false);
  }

  console.log();

  if (!hasAnyAuth) {
    console.log(c("red", "  ⚠ No xAI credentials found. Choose one:"));
    console.log();
    console.log(`    ${c("yellow", "Option A: Browser auth (recommended)")}`);
    console.log("      hermes model    → select xAI Grok OAuth");
    console.log();
    console.log(`    ${c("yellow", "Option B: API key")}`);
    console.log("      Get a key from https://console.x.ai/");
    console.log("      Then: hermes config set XAI_API_KEY <your-key>");
    console.log(`      Or add XAI_API_KEY=... to ${ENV_FILE}`);
    console.log();
    console.log("  Re-run this script after setting up auth.");
    console.log();
  }

  // 2. Plugin status
  console.log(c("cyan", "▸ Plugins"));
  console.log();

  const plugins = detectPluginStatus();
  for (const [name, info] of Object.entries(plugins)) {
    const detail = info.enabled ? "enabled"
      : info.exists ? "installed (not enabled)"
      : "NOT FOUND";
    check("🔌", `${name} (v${info.version})`, info.enabled, detail);
    if (info.exists && !info.enabled) {
      console.log(`      → Enable: hermes plugins enable ${name}`);
    }
  }

  console.log();

  // 3. Image gen provider config
  console.log(c("cyan", "▸ Provider Selection"));
  console.log();

  let activeProvider = "";
  if (existsSync(CONFIG_FILE)) {
    try {
      const cfg = yaml.load(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, any>;
      activeProvider = cfg?.image_gen?.provider ?? "";
    } catch {
      // ignore
    }
  }

  if (activeProvider === "xai") {
    check("⚙️", "image_gen.provider = xai", true, "explicitly configured");
  } else if (activeProvider) {
    check("⚙️", `image_gen.provider = ${activeProvider}`, false,
      `expected "xai" — hermes may use a different backend`);
    console.log(`      → Fix: hermes config set image_gen.provider xai`);
    console.log(c("yellow", "      ⚠ Restart hermes after changing config (new session required)."));
  } else {
    check("⚙️", "image_gen.provider not set", false,
      "falls back to FAL (legacy default)");
    console.log(`      → Fix: hermes config set image_gen.provider xai`);
    console.log(c("yellow", "      ⚠ Restart hermes after changing config (new session required)."));
  }

  console.log();

  // 4. Toolset status
  console.log(c("cyan", "▸ Toolsets"));
  console.log();
  console.log("  Run this to check & enable:");
  console.log("    hermes tools list          # see current status");
  console.log("    hermes tools enable image_gen   # enable image gen");
  console.log("    hermes tools enable video_gen   # enable video gen");
  console.log();

  // 5. Readiness summary
  console.log(c("cyan", "▸ Readiness Summary"));
  console.log();

  const pluginOk = plugins["image_gen/xai"]?.exists ?? false;
  const pluginEnabled = plugins["image_gen/xai"]?.enabled ?? false;

  const providerOk = activeProvider === "xai";

  if (hasAnyAuth && pluginEnabled && providerOk) {
    console.log(c("green", "  ✅ Looks good! Try generating an image:"));
    console.log();
    console.log('    hermes -z "猫の侍を墨絵スタイルで描いて"');
    console.log();
    if (!oauth) {
      console.log(c("yellow", "  💡 Tip: You're using an API key. Consider switching to OAuth"));
      console.log(c("yellow", "     (browser auth) for a smoother experience: hermes model"));
      console.log();
    }
  } else if (hasAnyAuth && pluginEnabled && !providerOk) {
    console.log(c("yellow", "  ⚠ Auth and plugin are ready, but image_gen.provider is not set to \"xai\"."));
    console.log(c("yellow", "    Fix: hermes config set image_gen.provider xai"));
    console.log();
  } else if (hasAnyAuth && !pluginOk) {
    console.log(c("yellow", "  ⚠ Auth is set but the image_gen/xai plugin is not installed."));
    console.log(c("yellow", "    Enable it with: hermes plugins enable image_gen/xai"));
    console.log();
  } else if (hasAnyAuth && !pluginEnabled) {
    console.log(c("yellow", "  ⚠ Plugin is installed but not enabled."));
    console.log(c("yellow", "    Enable it with: hermes plugins enable image_gen/xai"));
    console.log();
  } else if (!hasAnyAuth && pluginOk) {
    console.log(c("yellow", "  ⚠ Plugin is installed but no credentials configured."));
    console.log(c("yellow", "    See auth options above."));
    console.log();
  } else {
    console.log(c("red", "  ✗ Both auth and plugin need setup. See instructions above."));
    console.log();
  }

  // 6. Also check video_gen
  const videoPlugin = plugins["video_gen/xai"];
  if (videoPlugin?.exists && !videoPlugin.enabled) {
    console.log(`  ${c("cyan", "ℹ")} video_gen/xai plugin is also available.`);
    console.log("    Enable: hermes plugins enable video_gen/xai");
    console.log("    Then:   hermes tools enable video_gen");
    console.log();
  } else if (videoPlugin?.enabled) {
    console.log(`  ${c("green", "ℹ")} video_gen/xai is also enabled — you can generate videos too!`);
    console.log();
  }

  console.log(c("bold", "═══════════════════════════════════"));
  console.log();
}

main();
