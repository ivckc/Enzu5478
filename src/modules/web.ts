import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { Module } from "../core/types";
import { goals, tasks } from "../core/data";
import { getSnapshots, runCommand } from "../core/snapshot";
import type { Outcome } from "../core/snapshot";
import { readLog } from "../core/log";
import { say } from "../core/result";

const PORT = 4747;
const HOST = "127.0.0.1"; // this computer only
const FILES: Record<string, string> = { "/": "index.html", "/raven.svg": "raven.svg" };
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml" };

// The page may only run these commands (not backup, restore, autostart, ...).
const ALLOWED = [
  "add", "done", "reopen", "link", "rename task", "delete task", "priority", "due",
  "sub add", "sub done", "sub reopen", "sub delete",
  "goal", "rename goal", "delete goal", "remind", "unremind",
  "habit add", "habit check", "habit uncheck", "habit rename", "habit note", "habit delete",
  // Everything below is also needed so the page can replace the terminal.
  "backup", "restore", "notify setup", "notify show", "notify test", "notify on", "notify off",
  "autostart on", "autostart off",
  // Read-only
  "list", "goals", "reminders", "habits", "backups", "log", "notify", "autostart",
];

// A secret made fresh at every start. Only this page receives it, inside its own HTML.
const TOKEN = crypto.randomBytes(16).toString("hex");
const questions = new Map<string, { run: () => Outcome; expires: number }>();

function send(res: http.ServerResponse, code: number, type: string, body: string): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function json(res: http.ServerResponse, code: number, value: unknown): void {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(value));
}

function isAllowed(text: string): boolean {
  return ALLOWED.some((name) => text === name || text.startsWith(name + " "));
}

function answer(res: http.ServerResponse, outcome: Outcome): void {
  let confirmId: string | undefined;
  if (outcome.confirm !== undefined) {
    confirmId = crypto.randomBytes(6).toString("hex");
    questions.set(confirmId, { run: outcome.confirm, expires: Date.now() + 60_000 });
  }
  json(res, 200, { ok: outcome.ok, lines: outcome.lines, confirmId });
}

function handleCommand(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin !== `http://localhost:${PORT}` && origin !== `http://${HOST}:${PORT}`) {
    return json(res, 403, { ok: false, lines: ["Forbidden"] });
  }
  if (req.headers["x-anzu-token"] !== TOKEN) {
    return json(res, 403, { ok: false, lines: ["Forbidden"] });
  }
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return json(res, 415, { ok: false, lines: ["Send JSON"] });
  }
  let body = "";
  let tooBig = false;
  req.on("data", (chunk: unknown) => {
    body += String(chunk);
    if (body.length > 4096) {
      tooBig = true;
    }
  });
  req.on("end", () => {
    if (tooBig) {
      return json(res, 413, { ok: false, lines: ["Too big"] });
    }
    let data: { text?: unknown; confirm?: unknown };
    try {
      data = JSON.parse(body) as { text?: unknown; confirm?: unknown };
    } catch {
      return json(res, 400, { ok: false, lines: ["Bad JSON"] });
    }
    for (const [id, q] of questions) {
      if (q.expires < Date.now()) {
        questions.delete(id);
      }
    }
    if (typeof data.confirm === "string") {
      const q = questions.get(data.confirm);
      if (q === undefined) {
        return json(res, 400, { ok: false, lines: ["That question expired. Try again."] });
      }
      questions.delete(data.confirm);
      return answer(res, q.run());
    }
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (text === "" || text.length > 500 || /[\r\n]/.test(text)) {
      return json(res, 400, { ok: false, lines: ["Bad command"] });
    }
    if (!isAllowed(text)) {
      return json(res, 403, { ok: false, lines: ["The page may not run that command."] });
    }
    answer(res, runCommand(text));
  });
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Only this computer: blocks other sites that try to talk to Anzu.
  const host = req.headers.host ?? "";
  if (host !== `localhost:${PORT}` && host !== `${HOST}:${PORT}`) {
    return send(res, 403, "text/plain", "Forbidden");
  }
  const url = (req.url ?? "/").split("?")[0];
  if (req.method === "POST" && url === "/api/command") {
    return handleCommand(req, res);
  }
  if (req.method !== "GET") {
    return send(res, 405, "text/plain", "Method not allowed");
  }
  if (url === "/api/state") {
    const log = readLog();
    return json(res, 200, {
      now: new Date().toISOString(),
      tasks,
      goals,
      ...getSnapshots(),
      activity: log === null ? [] : log.entries.slice(-12),
    });
  }
  if (url === "/api/export") {
    const snap = getSnapshots();
    const day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="anzu-export-${day}.json"`,
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ exportedAt: new Date().toISOString(), tasks, goals, reminders: snap.reminders ?? [], habits: snap.habits ?? [] }, null, 2));
    return;
  }
  const file = FILES[url];
  if (file === undefined) {
    return send(res, 404, "text/plain", "Not found");
  }
  try {
    const text = fs.readFileSync(path.join("web", file), "utf8");
    send(res, 200, TYPES[path.extname(file)], text.replace("__TOKEN__", TOKEN));
  } catch {
    send(res, 500, "text/plain", "Could not read the page file");
  }
}

export const webModule: Module = {
  name: "web",
  init: () => {
    const server = http.createServer(handle);
    server.on("error", () => {
      console.log(`Note: the web page could not start (port ${PORT} is busy). Everything else works.`);
    });
    server.listen(PORT, HOST);
    (server as unknown as { unref?: () => void }).unref?.();
    return [];
  },
  commands: [
    {
      name: "web",
      usage: "web",
      about: "show the web page address",
      run: () => say(`Open this in Chrome: http://localhost:${PORT}`),
    },
  ],
};
