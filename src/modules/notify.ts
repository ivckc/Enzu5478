import * as crypto from "node:crypto";
import type { Job, LogInfo, Module, Notice, Result } from "../core/types";
import {
  nextIdFor,
  readJsonArray,
  readJsonObject,
  saveJsonArray,
  saveJsonObject,
} from "../core/storage";
import { problem, say } from "../core/result";
import { DataDamaged, damagedLines, perUserArray, perUserObject } from "../core/userctx";

const CONFIG_FILE = "notify.json";
const OUTBOX_FILE = "outbox.json";
const DEFAULT_SERVER = "https://ntfy.sh";
const SEND_EVERY_MS = 5_000;
const SEND_TIMEOUT_MS = 8_000;
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000; // stop trying after a day
const RETRY_AFTER_SECONDS = [30, 60, 120, 300, 600]; // the last one repeats
const MAX_PER_TICK = 5;
const MAX_MESSAGE_CHARS = 1000;
const MAX_TITLE_CHARS = 100;

type Config = {
  enabled: boolean;
  server: string;
  topic: string | null;
};

// A message waiting to be sent to the phone.
type OutboxItem = {
  id: number;
  title: string;
  message: string;
  priority: number;
  tags: string[];
  announce: boolean; // true for "notify test": tell the user when it arrives
  createdAt: string;
  attempts: number; // how many sends failed so far
  nextTryAt: string;
  lastError: string | null;
};

// Each user has their OWN phone topic, settings and waiting messages.
function loadConfigFile(): Config {
  const loaded = readJsonObject(CONFIG_FILE);
  if (loaded === null || (loaded !== undefined && !isConfig(loaded))) {
    throw new DataDamaged([
      "notify.json is damaged.",
      "I stopped so I do not overwrite it.",
      "Fix it or rename it, then run me again.",
    ]);
  }
  if (loaded === undefined) {
    return { enabled: false, server: DEFAULT_SERVER, topic: null };
  }
  return {
    enabled: loaded.enabled as boolean,
    server: loaded.server as string,
    topic: loaded.topic as string | null,
  };
}

function loadOutboxFile(): OutboxItem[] {
  const loaded = readJsonArray<unknown>(OUTBOX_FILE);
  if (loaded === null || !loaded.every(isOutboxItem)) {
    throw new DataDamaged([
      "outbox.json is damaged.",
      "I stopped so I do not overwrite it.",
      "Fix it or rename it, then run me again.",
    ]);
  }
  return loaded as OutboxItem[];
}

const config: Config = perUserObject<Config>(loadConfigFile);
const outbox: OutboxItem[] = perUserArray<OutboxItem>(loadOutboxFile);

// ---------- files ----------

function saveConfig(): boolean {
  return saveJsonObject(CONFIG_FILE, config);
}

function saveOutbox(): boolean {
  return saveJsonArray(OUTBOX_FILE, outbox);
}

function isConfig(x: Record<string, unknown>): boolean {
  const topicOk = x.topic === null || (typeof x.topic === "string" && /^[a-z0-9_-]{8,64}$/.test(x.topic));
  const serverOk = typeof x.server === "string" && /^https?:\/\/[^\s]+$/.test(x.server);
  return typeof x.enabled === "boolean" && serverOk && topicOk;
}

function isOutboxItem(x: unknown): x is OutboxItem {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    typeof o.message === "string" &&
    typeof o.priority === "number" &&
    Array.isArray(o.tags) &&
    typeof o.announce === "boolean" &&
    typeof o.createdAt === "string" &&
    !Number.isNaN(Date.parse(o.createdAt)) &&
    typeof o.attempts === "number" &&
    typeof o.nextTryAt === "string" &&
    !Number.isNaN(Date.parse(o.nextTryAt)) &&
    (o.lastError === null || typeof o.lastError === "string")
  );
}

// ---------- the secret topic ----------

// 31 characters, without look-alikes (no 0/o, 1/l/i).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateTopic(): string {
  let id = "";
  while (id.length < 16) {
    for (const b of crypto.randomBytes(32)) {
      // 248 = 31 * 8: skip bigger values so every character is equally likely
      if (b < 248 && id.length < 16) {
        id += ALPHABET[b % 31];
      }
    }
  }
  return `anzu-${id}`;
}

function maskTopic(topic: string): string {
  return topic.slice(0, 7) + "*".repeat(Math.max(0, topic.length - 7));
}

// ---------- sending ----------

type Outcome = { ok: true } | { ok: false; retry: boolean; error: string };

async function post(cfg: Config, item: OutboxItem): Promise<Outcome> {
  try {
    const response = await fetch(cfg.server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: cfg.topic,
        title: item.title,
        message: item.message,
        priority: item.priority,
        tags: item.tags,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await response.text().catch(() => "");
    if (response.ok) {
      return { ok: true };
    }
    // Too many requests, timeouts and server problems are worth trying again. The rest are not.
    const retry = response.status === 429 || response.status === 408 || response.status >= 500;
    return { ok: false, retry, error: `HTTP ${response.status}` };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, retry: true, error: timedOut ? "timed out" : "no connection" };
  }
}

function retryDelayMs(attempts: number): number {
  const index = Math.min(attempts, RETRY_AFTER_SECONDS.length) - 1;
  return RETRY_AFTER_SECONDS[Math.max(0, index)] * 1000;
}

function removeItem(item: OutboxItem): void {
  const index = outbox.indexOf(item);
  if (index !== -1) {
    outbox.splice(index, 1);
  }
}

async function deliver(): Promise<Result | null> {
  const lines: string[] = [];
  const logs: LogInfo[] = [];
  const nowMs = Date.now();

  // 1. Give up on messages that are too old.
  const expired = outbox.filter((i) => nowMs - Date.parse(i.createdAt) > GIVE_UP_AFTER_MS);
  for (const item of expired) {
    removeItem(item);
    lines.push(`[notify] I gave up sending "${item.title}" to your phone after 24 hours.`);
    logs.push({
      action: "notify.send",
      detail: `#${item.id} ${item.title}: gave up after 24 hours`,
      ok: false,
      actor: "anzu",
    });
  }
  if (expired.length > 0 && !saveOutbox()) {
    logs.push({ action: "notify.save", detail: "could not save the outbox", ok: false, actor: "anzu" });
  }

  // 2. Send what is due (only when phone notifications are on).
  if (config.enabled && config.topic !== null) {
    const due = outbox
      .filter((i) => Date.parse(i.nextTryAt) <= nowMs)
      .sort((a, b) => a.id - b.id)
      .slice(0, MAX_PER_TICK);
    for (const item of due) {
      const outcome = await post(config, item);
      if (outcome.ok) {
        removeItem(item);
        const after = item.attempts > 0 ? ` (after ${item.attempts} failed attempt(s))` : "";
        logs.push({
          action: "notify.send",
          detail: `#${item.id} ${item.title}${after}`,
          ok: true,
          actor: "anzu",
        });
        if (item.announce) {
          lines.push("[notify] The test message reached ntfy. Look at your phone.");
        }
      } else if (!outcome.retry) {
        removeItem(item);
        lines.push(`[notify] ntfy refused a message (${outcome.error}). Type notify to check.`);
        logs.push({
          action: "notify.send",
          detail: `#${item.id} ${item.title}: refused (${outcome.error})`,
          ok: false,
          actor: "anzu",
        });
      } else {
        item.attempts = item.attempts + 1;
        item.lastError = outcome.error;
        item.nextTryAt = new Date(Date.now() + retryDelayMs(item.attempts)).toISOString();
        if (item.attempts === 1) {
          lines.push(`[notify] I could not reach ntfy (${outcome.error}). I will keep trying.`);
          logs.push({
            action: "notify.send",
            detail: `#${item.id} ${item.title}: ${outcome.error}, will retry`,
            ok: false,
            actor: "anzu",
          });
        }
      }
      if (!saveOutbox()) {
        logs.push({ action: "notify.save", detail: "could not save the outbox", ok: false, actor: "anzu" });
      }
    }
  }

  if (lines.length === 0 && logs.length === 0) {
    return null;
  }
  return { ok: true, lines, logs };
}

const sendJob: Job = {
  name: "notify",
  everyMs: SEND_EVERY_MS,
  run: deliver,
};

// ---------- queueing ----------

function enqueue(notice: Notice, announce: boolean): boolean {
  const nowIso = new Date().toISOString();
  const item: OutboxItem = {
    id: nextIdFor(outbox),
    title: notice.title.slice(0, MAX_TITLE_CHARS),
    message: notice.message.slice(0, MAX_MESSAGE_CHARS),
    priority: notice.priority ?? 3,
    tags: notice.tags ?? [],
    announce,
    createdAt: nowIso,
    attempts: 0,
    nextTryAt: nowIso,
    lastError: null,
  };
  outbox.push(item);
  if (saveOutbox()) {
    return true;
  }
  outbox.pop();
  return false;
}

function isReady(): boolean {
  return config.enabled && config.topic !== null;
}

// ---------- commands ----------

function statusResult(): Result {
  if (config.topic === null) {
    return say("Phone notifications: not set up. Type notify setup.");
  }
  const lines = [
    `Phone notifications: ${config.enabled ? "ON" : "OFF"}`,
    `Server: ${config.server}`,
    `Topic: ${maskTopic(config.topic)}  (type notify show to see all of it)`,
    `Waiting to be sent: ${outbox.length}`,
  ];
  const lastError = outbox.map((i) => i.lastError).find((e) => e !== null);
  if (lastError !== undefined && lastError !== null) {
    lines.push(`Last problem: ${lastError} (I keep trying)`);
  }
  return say(...lines);
}

function doSetup(): Result {
  const previous: Config = { ...config };
  Object.assign(config, { enabled: true, topic: generateTopic() });
  if (!saveConfig()) {
    Object.assign(config, previous);
    return {
      ok: false,
      lines: ["Could not save the settings. Nothing was changed."],
      logs: [{ action: "notify.setup", detail: "could not save", ok: false }],
    };
  }
  return {
    ok: true,
    lines: [
      `Your private topic: ${config.topic}`,
      "Now, on your phone:",
      "1. Install the ntfy app (Google Play or F-Droid).",
      "2. Open it, tap +, and type the topic above exactly. Keep the default server.",
      "3. Come back here and type: notify test",
      "Keep the topic secret. Anyone who knows it can read your notifications.",
    ],
    logs: [{ action: "notify.setup", detail: "private topic created", ok: true }],
  };
}

export const notifyModule: Module = {
  name: "notify",
  init: () => {
    try {
      void config.enabled; // checks the owner's files now; other users load when they first use it
      void outbox.length;
    } catch (e) {
      return damagedLines(e);
    }
    return [];
  },
  jobs: [sendJob],
  snapshot: () => ({ enabled: config.enabled, ready: config.topic !== null, waiting: outbox.length, server: config.server, topic: config.topic === null ? null : maskTopic(config.topic), problem: config.enabled ? (outbox.map((i) => i.lastError).find((e) => e !== null) ?? null) : null }),
  onNotice: (notice) => {
    if (!isReady()) {
      return null;
    }
    if (enqueue(notice, false)) {
      return null;
    }
    return {
      ok: false,
      lines: ["Note: I could not queue the phone notification."],
      logs: [{ action: "notify.queue", detail: notice.title, ok: false, actor: "anzu" }],
    };
  },
  commands: [
    {
      name: "notify",
      usage: "notify",
      about: "phone notifications: status",
      run: (rest) => {
        if (rest !== "") {
          return problem("Use: notify  or  notify setup | show | test | on | off");
        }
        return statusResult();
      },
    },
    {
      name: "notify setup",
      usage: "notify setup",
      about: "create your private topic",
      run: () => {
        if (config.topic !== null) {
          return {
            ok: true,
            lines: [
              "You already have a topic. A new one replaces it, and your phone must subscribe again.",
              "Type yes to create a new one.",
            ],
            confirm: doSetup,
          };
        }
        return doSetup();
      },
    },
    {
      name: "notify show",
      usage: "notify show",
      about: "show your full topic",
      run: () => {
        if (config.topic === null) {
          return problem("No topic yet. Type notify setup.");
        }
        return say(`Your private topic: ${config.topic}`, "Keep it secret.");
      },
    },
    {
      name: "notify test",
      usage: "notify test",
      about: "send a test to your phone",
      run: () => {
        if (config.topic === null) {
          return problem("Phone notifications are not set up. Type notify setup.");
        }
        if (!config.enabled) {
          return problem("Phone notifications are OFF. Type notify on.");
        }
        const queued = enqueue(
          {
            title: "Anzu test",
            message: "If you can read this, your phone is connected to Anzu.",
            priority: 3,
            tags: ["bell"],
          },
          true
        );
        if (!queued) {
          return {
            ok: false,
            lines: ["Could not queue the test. Nothing was changed."],
            logs: [{ action: "notify.test", detail: "could not queue", ok: false }],
          };
        }
        return {
          ok: true,
          lines: ["Test message queued. It should reach your phone in a few seconds."],
          logs: [{ action: "notify.test", detail: "queued", ok: true }],
        };
      },
    },
    {
      name: "notify on",
      usage: "notify on",
      about: "turn phone notifications on",
      run: () => {
        if (config.topic === null) {
          return problem("Phone notifications are not set up. Type notify setup.");
        }
        if (config.enabled) {
          return say("Phone notifications are already ON.");
        }
        config.enabled = true;
        if (saveConfig()) {
          return {
            ok: true,
            lines: ["Phone notifications are ON."],
            logs: [{ action: "notify.on", detail: "turned on", ok: true }],
          };
        }
        config.enabled = false;
        return {
          ok: false,
          lines: ["Could not save the settings. Nothing was changed."],
          logs: [{ action: "notify.on", detail: "could not save", ok: false }],
        };
      },
    },
    {
      name: "notify off",
      usage: "notify off",
      about: "turn phone notifications off",
      run: () => {
        if (config.topic === null || !config.enabled) {
          return say("Phone notifications are already OFF.");
        }
        config.enabled = false;
        if (saveConfig()) {
          return {
            ok: true,
            lines: ["Phone notifications are OFF. Messages already waiting are kept until you turn them on."],
            logs: [{ action: "notify.off", detail: "turned off", ok: true }],
          };
        }
        config.enabled = true;
        return {
          ok: false,
          lines: ["Could not save the settings. Nothing was changed."],
          logs: [{ action: "notify.off", detail: "could not save", ok: false }],
        };
      },
    },
  ],
};
