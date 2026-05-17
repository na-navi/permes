/**
 * /hermes command + hermes-review tool
 *
 * Architecture: async sub-agent via `hermes` CLI
 * - /hermes spawns a background task using `hermes chat -q` (TUI-independent)
 * - pi TUI stays responsive (ESC works)
 * - Background task continues even if user cancels display
 * - Results stored in memory, retrievable via /hermes --result <id>
 *
 * Flow:
 *   1. /hermes <message> → spawns background task → returns immediately
 *   2. Background task: `hermes chat -q "msg" -m model --provider provider`
 *   3. Parse response + session ID from CLI output
 *   4. On completion: inject result to pi via sendUserMessage with review instructions
 *   5. pi reviews autonomously:
 *      - No errors → output final result
 *      - Errors → hermes-review tool (uses `hermes -z --resume <sessionId>`)
 *      - Escalation needed → report to user
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const DIR = join(homedir(), ".pi", "agent", "extensions", "hermes-bin");
const MODEL_CACHE = join(DIR, ".default-model");
const DEFAULT_MODEL = "grok-4.3";
const MAX_REVIEW_ROUNDS = 3;
const TASK_TIMEOUT = 180; // seconds (per-response)

// --- Task state ---
interface HermesTask {
  id: string;
  message: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  response?: string;
  error?: string;
  model?: string;
  sessionId?: string;
  abort?: AbortController;
  createdAt: number;
  completedAt?: number;
}

const tasks = new Map<string, HermesTask>();

// --- Shared state for review context ---
let activeModel: string | null = null;
let activeSessionId: string | null = null;

// --- Model cache ---

interface ModelInfo {
  model: string;
  provider?: string;
}

function readCachedModel(): ModelInfo | null {
  try {
    if (!existsSync(MODEL_CACHE)) return null;
    const raw = readFileSync(MODEL_CACHE, "utf8").trim();
    if (!raw) return null;
    const [model, provider] = raw.split("|");
    return { model, provider: provider || undefined };
  } catch { return null; }
}

function writeCachedModel(model: string, provider?: string): void {
  writeFileSync(MODEL_CACHE, provider ? `${model}|${provider}` : model);
}

// --- CLI helpers ---

/**
 * Parse `hermes chat -q` output to extract session ID and response text.
 *
 * Output format:
 *   Query: ...
 *   Initializing agent...
 *   ──────
 *   ╭─ ⚕ Hermes ───╮
 *       <response text>
 *   ╰───────────────╯
 *   Resume this session with:
 *     hermes --resume <SESSION_ID>
 *   Session:        <SESSION_ID>
 *   Duration:       4s
 *   Messages:       2 (1 user, 0 tool calls)
 */
function parseChatOutput(output: string): { sessionId: string | null; response: string } {
  // Extract session ID
  const sessionMatch = output.match(/hermes --resume (\S+)/);
  const sessionId = sessionMatch?.[1] || null;

  // Extract response from ╭─...╰─ block
  const blockMatch = output.match(/╭─[\s\S]*?╮\n([\s\S]*?)╰─/);
  if (blockMatch) {
    const text = blockMatch[1]
      .split("\n")
      .map(line => line.replace(/^\s{4}/, "")) // strip leading indent
      .join("\n")
      .trim();
    return { sessionId, response: text };
  }

  // Fallback: return raw output stripped of metadata
  const lines = output.split("\n").filter(l =>
    !l.startsWith("Query:") &&
    !l.startsWith("Initializing") &&
    !l.startsWith("──") &&
    !l.startsWith("Resume this") &&
    !l.startsWith("  hermes") &&
    !l.startsWith("Session:") &&
    !l.startsWith("Duration:") &&
    !l.startsWith("Messages:") &&
    !l.startsWith("╭─") &&
    !l.startsWith("╰─")
  );
  return { sessionId, response: lines.join("\n").trim() || output.trim() };
}

/** Send initial message via `hermes chat -q` — returns response + session ID. */
async function sendInitial(message: string, model: string, provider: string | undefined, signal?: AbortSignal): Promise<{ response: string; sessionId: string | null }> {
  const args = ["chat", "-q", message, "-m", model];
  if (provider) args.push("--provider", provider);

  const { stdout } = await execFileAsync("hermes", args, {
    timeout: (TASK_TIMEOUT + 10) * 1000,
    maxBuffer: 1024 * 1024,
    signal,
  });

  return parseChatOutput(stdout);
}

/** Send review feedback via `hermes -z --resume` — returns raw response text. */
async function sendReview(feedback: string, model: string, sessionId: string, provider: string | undefined, signal?: AbortSignal): Promise<string> {
  const args = ["-z", feedback, "-m", model, "--resume", sessionId];
  if (provider) args.push("--provider", provider);

  const { stdout } = await execFileAsync("hermes", args, {
    timeout: (TASK_TIMEOUT + 10) * 1000,
    maxBuffer: 1024 * 1024,
    signal,
  });

  return stdout.trim();
}

function resolveModel(args: string): { model: string; provider?: string; message: string } {
  const parts = args.split(/\s+/);

  // Parse -m and -p flags
  let model: string | undefined;
  let provider: string | undefined;
  let remaining: string[] = [];
  let i = 0;

  while (i < parts.length) {
    if (parts[i] === "-m" && parts[i + 1]) {
      model = parts[i + 1];
      i += 2;
    } else if (parts[i] === "-p" && parts[i + 1]) {
      provider = parts[i + 1];
      i += 2;
    } else {
      remaining.push(parts[i]);
      i++;
    }
  }

  const message = remaining.join(" ");

  // Use cached model if not specified
  if (!model) {
    const cached = readCachedModel();
    model = cached?.model || DEFAULT_MODEL;
    if (!provider) provider = cached?.provider;
  }

  // Cache the resolved model
  if (model) writeCachedModel(model, provider);

  return { model, provider, message };
}

// --- Background task runner ---

async function runTask(task: HermesTask, model: string, provider: string | undefined, pi: ExtensionAPI): Promise<void> {
  const ac = new AbortController();
  task.abort = ac;
  task.status = "running";

  try {
    const { response, sessionId } = await sendInitial(task.message, model, provider, ac.signal);
    task.response = response;
    task.sessionId = sessionId;
    task.model = model;
    activeModel = model;
    activeSessionId = sessionId;
    task.status = "done";
    task.completedAt = Date.now();

    // Inject to pi with review instructions
    pi.sendUserMessage([
      `Hermes task ${task.id} completed.\n`,
      `Question: > ${task.message}\n`,
      `Hermes (${model}) responded:\n`,
      `${response}\n`,
      `---\n`,
      `Review the response autonomously:\n`,
      `1. If it contains code or commands, dry-test them (run in bash, check syntax, etc.)\n`,
      `2. If you find errors, use the \`hermes-review\` tool to send feedback. Max ${MAX_REVIEW_ROUNDS} rounds.\n`,
      `3. If Hermes corrects the error, silently apply the fix.\n`,
      `4. If unresolved after ${MAX_REVIEW_ROUNDS} rounds, report details to the user.\n`,
      `5. If no errors, synthesize and respond. Do NOT report to user unless something went wrong.`,
    ].join("\n"));

  } catch (err: any) {
    if (err.message === "Aborted" || err.name === "AbortError") {
      task.status = "cancelled";
      task.error = "Cancelled by user";
    } else {
      task.status = "error";
      task.error = err.message;
      pi.sendUserMessage(`Hermes task ${task.id} failed: ${err.message}`);
    }
  }
}

// --- Main ---

export default function (pi: ExtensionAPI) {

  // Show running task count in status bar
  pi.on("turn_start", async (_event, ctx) => {
    const running = [...tasks.values()].filter(t => t.status === "running").length;
    if (running > 0) {
      ctx.ui.setStatus("hermes", `hermes: ${running} task(s) running`);
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    const running = [...tasks.values()].filter(t => t.status === "running").length;
    if (running === 0) {
      ctx.ui.setStatus("hermes", "");
    }
  });

  // === /hermes command ===
  pi.registerCommand("hermes", {
    description: "Ask any model via Hermes CLI (non-blocking). Usage: /hermes <message> | /hermes -m model <message> | /hermes --status | /hermes --result <id> | /hermes --cancel <id> | /hermes --reset-model",
    handler: async (args, ctx) => {
      const text = (args || "").trim();
      const parts = text.split(/\s+/);
      const cmd = parts[0];

      // --status: list tasks
      if (cmd === "--status") {
        const all = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
        if (all.length === 0) {
          ctx.ui.notify("No hermes tasks.", "info");
          return;
        }
        const lines = all.map(t =>
          `[${t.id.slice(0, 8)}] ${t.status} ${t.model || "?"} ${t.message.slice(0, 50)}${t.message.length > 50 ? "…" : ""}`
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // --result: show completed task result
      if (cmd === "--result" && parts[1]) {
        const id = parts[1];
        const task = tasks.get(id) || [...tasks.values()].find(t => t.id.startsWith(id));
        if (!task) {
          ctx.ui.notify(`Task ${id} not found.`, "error");
          return;
        }
        if (task.status === "done" && task.response) {
          pi.sendUserMessage(`Hermes task ${task.id} result:\n${task.response}`);
        } else {
          ctx.ui.notify(`Task ${task.id} status: ${task.status}${task.error ? ` (${task.error})` : ""}`, "info");
        }
        return;
      }

      // --cancel: cancel a running task
      if (cmd === "--cancel" && parts[1]) {
        const id = parts[1];
        const task = tasks.get(id) || [...tasks.values()].find(t => t.id.startsWith(id));
        if (!task) {
          ctx.ui.notify(`Task ${id} not found.`, "error");
          return;
        }
        if (task.status === "running" && task.abort) {
          task.abort.abort();
          ctx.ui.notify(`Cancelling task ${task.id}...`, "info");
        } else {
          ctx.ui.notify(`Task ${task.id} is ${task.status} (not running).`, "warn");
        }
        return;
      }

      // --reset-model
      if (cmd === "--reset-model") {
        if (existsSync(MODEL_CACHE)) unlinkSync(MODEL_CACHE);
        ctx.ui.notify("Hermes model cache cleared.", "info");
        return;
      }

      // Default: send message to model
      const { model, provider, message } = resolveModel(text);
      if (!message) {
        ctx.ui.notify("Usage: /hermes <message> | /hermes -m model <message> | /hermes --status | /hermes --result <id> | /hermes --cancel <id> | /hermes --reset-model", "warn");
        return;
      }

      // Spawn background task
      const id = randomUUID();
      const task: HermesTask = {
        id,
        message,
        status: "pending",
        createdAt: Date.now(),
      };
      tasks.set(id, task);

      ctx.ui.notify(`→ Hermes task ${id.slice(0, 8)} started (${model}): ${message.slice(0, 50)}${message.length > 50 ? "…" : ""}`, "info");
      ctx.ui.setStatus("hermes", `hermes: ${id.slice(0, 8)} running`);

      // Fire and forget — pi TUI stays responsive
      runTask(task, model, provider, pi).catch(() => {}); // Errors handled inside runTask

      // Cleanup old tasks (>100)
      if (tasks.size > 100) {
        const sorted = [...tasks.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
        for (const [oldId] of sorted.slice(50)) {
          tasks.delete(oldId);
        }
      }
    },
  });

  // === hermes-review tool ===
  pi.registerTool({
    name: "hermes-review",
    description:
      "Send review feedback to Grok about its previous response within the current /hermes session. " +
      "Use ONLY when /hermes was initiated and pi found errors in Grok's response that need correction. " +
      "Each call counts as one review round (max " + MAX_REVIEW_ROUNDS + "). " +
      "Do NOT use for new questions — use /hermes command instead.",
    parameters: Type.Object({
      feedback: Type.String({
        description: "Specific feedback about what was wrong and what needs to be fixed. Be precise and constructive.",
      }),
      round: Type.Number({
        description: "Current review round number (1-" + MAX_REVIEW_ROUNDS + ")",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { feedback, round } = params;

      if (round > MAX_REVIEW_ROUNDS) {
        return {
          content: [{ type: "text", text: `Max review rounds (${MAX_REVIEW_ROUNDS}) exceeded. Report current state to the user.` }],
          details: {},
        };
      }

      if (!activeSessionId || !activeModel) {
        return {
          content: [{ type: "text", text: "No active /hermes session to review. Use /hermes first." }],
          details: {},
        };
      }

      const cached = readCachedModel();

      try {
        const response = await sendReview(
          `レビュー指摘（${round}/${MAX_REVIEW_ROUNDS}）:\n${feedback}\n\n修正して再度回答してください。`,
          activeModel,
          activeSessionId,
          cached?.provider,
          signal
        );
        return {
          content: [{ type: "text", text: response }],
          details: { round, model: activeModel, sessionId: activeSessionId },
        };
      } catch (err: any) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Review cancelled by user." }],
            details: {},
          };
        }
        return {
          content: [{ type: "text", text: `Error sending review: ${err.message}` }],
          details: {},
        };
      }
    },
  });
}
