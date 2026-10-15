import type { Job, LogInfo, Module, Notice, Result } from "../core/types";
import { nextIdFor, readJsonArray, saveJsonArray } from "../core/storage";
import { splitFirst, toId } from "../core/parse";
import { problem, say } from "../core/result";

type Reminder = {
  id: number;
  userId: string;
  text: string;
  at: string; // when it is due (ISO time, UTC)
  status: "pending" | "fired" | "cancelled";
  firedAt: string | null;
};

const REMINDERS_FILE = "reminders.json";
const CHECK_EVERY_MS = 10_000;
const LATE_AFTER_MS = 90_000; // shown later than this after its time = "late"

const reminders: Reminder[] = [];

function now(): Date {
  return new Date(Date.now());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 2026-10-03 18:30 (your computer's local time)
function formatLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

function describeWait(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) {
    return "in less than a minute";
  }
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} d`);
  }
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min`);
  }
  return "in " + parts.join(" ");
}

function saveReminders(): boolean {
  return saveJsonArray(REMINDERS_FILE, reminders);
}

function isReminder(x: unknown): x is Reminder {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.userId === "string" &&
    typeof o.text === "string" &&
    typeof o.at === "string" &&
    !Number.isNaN(new Date(o.at).getTime()) &&
    (o.status === "pending" || o.status === "fired" || o.status === "cancelled") &&
    (o.firedAt === null || typeof o.firedAt === "string")
  );
}

// ---------- understanding the time the user typed ----------

const USAGE = [
  "Use: remind in <30m | 2h | 1h30m | 1d> <text>",
  " or: remind at <HH:MM> <text>",
  " or: remind tomorrow <HH:MM> <text>",
  " or: remind <YYYY-MM-DD> <HH:MM> <text>",
];

function parseTime(s: string): { h: number; m: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (match === null) {
    return null;
  }
  return { h: Number(match[1]), m: Number(match[2]) };
}

export type When = { at: Date; text: string } | { error: string[] };

// "in 30m call Ahmed" -> { at: now + 30 minutes, text: "call Ahmed" }
export function parseWhen(input: string, current: Date): When {
  const first = splitFirst(input);
  const second = splitFirst(first.others);
  const key = first.first;
  const value = second.first;
  const text = second.others;

  let at: Date;

  if (key === "in") {
    const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(value);
    if (value === "" || match === null) {
      return { error: ["I did not understand the wait time.", ...USAGE] };
    }
    const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    if (minutes < 1) {
      return { error: ["The wait must be at least 1 minute."] };
    }
    if (minutes > 366 * 1440) {
      return { error: ["That is too far away (the limit is 366 days)."] };
    }
    at = new Date(current.getTime() + minutes * 60000);
  } else if (key === "at" || key === "tomorrow") {
    const time = parseTime(value);
    if (time === null) {
      return { error: ["I did not understand the time. Use HH:MM, for example 18:30.", ...USAGE] };
    }
    const dayOffset = key === "tomorrow" ? 1 : 0;
    at = new Date(current.getFullYear(), current.getMonth(), current.getDate() + dayOffset, time.h, time.m, 0, 0);
    if (key === "at" && at.getTime() <= current.getTime()) {
      // That time already passed today: use tomorrow. The reply shows the exact date.
      at = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, time.h, time.m, 0, 0);
    }
  } else {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (date === null) {
      return { error: USAGE };
    }
    const time = parseTime(value);
    if (time === null) {
      return { error: ["I did not understand the time. Use HH:MM, for example 18:30.", ...USAGE] };
    }
    const y = Number(date[1]);
    const mo = Number(date[2]);
    const d = Number(date[3]);
    at = new Date(y, mo - 1, d, time.h, time.m, 0, 0);
    if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) {
      return { error: ["That date does not exist."] };
    }
    if (at.getTime() <= current.getTime()) {
      return { error: ["That time is already in the past."] };
    }
  }

  if (text === "") {
    return { error: ["Write the reminder text after the time.", ...USAGE] };
  }
  return { at, text };
}

// ---------- the job that shows reminders when they are due ----------

function checkReminders(): Result | null {
  const nowMs = Date.now();
  const due = reminders
    .filter((r) => r.status === "pending" && new Date(r.at).getTime() <= nowMs)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (due.length === 0) {
    return null;
  }
  const lines: string[] = [];
  const logs: LogInfo[] = [];
  const notices: Notice[] = [];
  for (const r of due) {
    r.status = "fired";
    r.firedAt = new Date(nowMs).toISOString();
    const dueDate = new Date(r.at);
    const late = nowMs - dueDate.getTime() > LATE_AFTER_MS;
    lines.push(
      late ? `[REMINDER] ${r.text} (was due ${formatLocal(dueDate)})` : `[REMINDER] ${r.text}`
    );
    notices.push({
      title: "Anzu reminder",
      message: late ? `${r.text} (was due ${formatLocal(dueDate)})` : r.text,
      priority: 4,
      tags: ["alarm_clock"],
    });
    logs.push({
      action: "reminder.fire",
      detail: `#${r.id} ${r.text}${late ? " (late)" : ""}`,
      ok: true,
      actor: "anzu",
    });
  }
  if (!saveReminders()) {
    lines.push("Note: I could not save that these reminders were shown.");
    lines.push("They may appear again after a restart.");
    logs.push({
      action: "reminder.save",
      detail: "could not save the shown state",
      ok: false,
      actor: "anzu",
    });
  }
  return { ok: true, lines, logs, notices };
}

const reminderJob: Job = {
  name: "reminders",
  everyMs: CHECK_EVERY_MS,
  run: checkReminders,
};

// Exports for tool adapters
export { reminders, now, saveReminders };

export const remindersModule: Module = {
  name: "reminders",
  init: () => {
    const loaded = readJsonArray<unknown>(REMINDERS_FILE);
    if (loaded === null || !loaded.every(isReminder)) {
      return [
        "reminders.json is damaged.",
        "I stopped so I do not overwrite it.",
        "Fix it or rename it, then run me again.",
      ];
    }
    for (const r of loaded) {
      reminders.push(r);
    }
    return [];
  },
  jobs: [reminderJob],
  snapshot: () => reminders,
  commands: [
    {
      name: "remind",
      usage: "remind <when> <text>",
      about: "set a reminder (type remind to see how)",
      run: (rest) => {
        const current = now();
        const parsed = parseWhen(rest, current);
        if ("error" in parsed) {
          return problem(...parsed.error);
        }
        const reminder: Reminder = {
          id: nextIdFor(reminders),
          userId: "local",
          text: parsed.text,
          at: parsed.at.toISOString(),
          status: "pending",
          firedAt: null,
        };
        reminders.push(reminder);
        const when = formatLocal(parsed.at);
        const detail = `#${reminder.id} ${when} ${reminder.text}`;
        if (saveReminders()) {
          const wait = describeWait(parsed.at.getTime() - current.getTime());
          return {
            ok: true,
            lines: [`Reminder ${reminder.id} set for ${when} (${wait}): ${reminder.text}`],
            logs: [{ action: "reminder.add", detail, ok: true }],
          };
        }
        reminders.pop();
        return {
          ok: false,
          lines: ["Could not save the reminder. Nothing was added."],
          logs: [{ action: "reminder.add", detail, ok: false }],
        };
      },
    },
    {
      name: "reminders",
      usage: "reminders [all]",
      about: "show pending reminders",
      run: (rest) => {
        const all = rest === "all";
        if (rest !== "" && !all) {
          return problem("Use: reminders  or  reminders all");
        }
        const shown = reminders
          .filter((r) => all || r.status === "pending")
          .sort((a, b) => a.at.localeCompare(b.at));
        if (shown.length === 0) {
          return say(all ? "No reminders yet." : "No pending reminders.");
        }
        const nowMs = Date.now();
        const lines = [all ? "All reminders:" : "Pending reminders:"];
        for (const r of shown) {
          const dueDate = new Date(r.at);
          const state =
            r.status === "pending"
              ? `(${describeWait(dueDate.getTime() - nowMs)})`
              : r.status === "fired"
                ? "[shown]"
                : "[cancelled]";
          lines.push(`${r.id}. ${formatLocal(dueDate)}  ${state}  ${r.text}`);
        }
        return say(...lines);
      },
    },
    {
      name: "unremind",
      usage: "unremind <n>",
      about: "cancel a pending reminder",
      run: (rest) => {
        const id = toId(rest);
        if (id === null) {
          return problem("Use: unremind <number>. Example: unremind 1");
        }
        const reminder = reminders.find((r) => r.id === id);
        if (reminder === undefined) {
          return problem(`There is no reminder ${id}.`);
        }
        if (reminder.status !== "pending") {
          return say(`Reminder ${id} is not pending (it is ${reminder.status}).`);
        }
        reminder.status = "cancelled";
        const detail = `#${id} ${reminder.text}`;
        if (saveReminders()) {
          return {
            ok: true,
            lines: [`Cancelled reminder ${id}: ${reminder.text}`],
            logs: [{ action: "reminder.cancel", detail, ok: true }],
          };
        }
        reminder.status = "pending";
        return {
          ok: false,
          lines: ["Could not save the change. Nothing was changed."],
          logs: [{ action: "reminder.cancel", detail, ok: false }],
        };
      },
    },
  ],
};
