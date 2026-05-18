#!/usr/bin/env node
/**
 * Send an image generation request to Hermes via Telegram.
 *
 * This script sends a message to your Telegram DM with the hermes bot.
 * The running hermes gateway picks it up, generates the image, and replies.
 *
 * Usage:
 *   npx tsx scripts/hermes-draw.ts "猫の侍を墨絵で描いて"
 *   npx tsx scripts/hermes-draw.ts "sunset over Tokyo, oil painting" --hd
 *
 * Options:
 *   --dry-run   Print the message without sending
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { request } from "https";

const HERMES_HOME =
  process.env.HERMES_HOME || join(homedir(), "AppData", "Local", "hermes");
const ENV_FILE = join(HERMES_HOME, ".env");

// --- Parse .env (minimal, no external deps) ---

function parseEnv(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) continue;
      const eq = stripped.indexOf("=");
      if (eq < 0) continue;
      const key = stripped.slice(0, eq).trim();
      const val = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      result[key] = val;
    }
  } catch {
    // ignore
  }
  return result;
}

// --- HTTPS POST ---

function httpsPost(url: string, body: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            reject(new Error(`Invalid JSON: ${buf.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timed out (10s)"));
    });
    req.write(data);
    req.end();
  });
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const message = args
    .filter((a) => !a.startsWith("--"))
    .join(" ")
    .trim();

  if (!message) {
    console.error("Usage: npx tsx scripts/hermes-draw.ts <prompt> [--hd] [--dry-run]");
    process.exit(1);
  }

  const env = parseEnv(ENV_FILE);
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_HOME_CHANNEL;

  if (!botToken) {
    console.error("Error: TELEGRAM_BOT_TOKEN not found in " + ENV_FILE);
    process.exit(1);
  }
  if (!chatId) {
    console.error("Error: TELEGRAM_HOME_CHANNEL not found in " + ENV_FILE);
    process.exit(1);
  }

  // Build the prompt that hermes will receive.
  // The `image_generate` tool needs a semantic trigger — mentioning the
  // backend name in natural language, e.g. "xAI image で生成して".
  // This mirrors how x_search requires "Xで検索" rather than just "検索して".
  const prompt = `${message}\n\nxAI image で画像を生成してください。`;

  console.log(`📤 Sending to Telegram (chat: ${chatId}):`);
  console.log(`   ${prompt}`);
  console.log();

  if (dryRun) {
    console.log("🔬 Dry run — not sending.");
    return;
  }

  try {
    const result = await httpsPost(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: prompt,
      }
    );

    if (result.ok) {
      console.log("✅ Message sent! Check Telegram — hermes will reply with the image.");
    } else {
      console.error(`❌ Telegram API error: ${result.description}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ Failed: ${err.message}`);
    process.exit(1);
  }
}

main();
