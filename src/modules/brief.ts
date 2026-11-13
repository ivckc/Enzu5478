import type { Job, LogInfo, Module, Notice, Result } from "../core/types";
import { readJsonObject, saveJsonObject } from "../core/storage";
import { problem, say } from "../core/result";
import { splitFirst } from "../core/parse";
import { tasks } from "../core/data";
import { getSnapshots } from "../core/snapshot";
import { reminders } from "./reminders";

// Morning brief: once a day, at the hour and on the days YOU choose (Settings page),
// Anzu sends a short summary to your phone (through the ntfy notifications).

const CONFIG_FILE = "brief.json";
const CHECK_EVERY_MS = 10_000;
const CATCH_UP_MIN = 120; // if Anzu was off at the chosen time, it still sends within 2 hours
const MAX_TASKS = 6;
const MAX_TEXT = 60;
const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // 0 = Sunday

type Config = {
  enabled: boolean;
  time: string; // "HH:MM" in the chosen time zone
  days: number[]; // 0 = Sunday ... 6 = Saturday
  tz: string; // for example Asia/Baghdad (the server may run in another time zone)
  lastSent: string | null; // "YYYY-MM-DD": the day it was already handled
};

function defaults(): Config {
  return { enabled: false, time: "08:00", days: [0, 1, 2, 3, 4, 5, 6], tz: "Asia/Baghdad", lastSent: null };
}

let config: Config = defaults();
let warnedDate: string | null = null; // warn only once a day when the phone is not ready
let pendingTest = false; // "brief test" waits for the next tick (same path as real reminders)

// ---------- file ----------

function saveConfig(): boolean {
  return saveJsonObject(CONFIG_FILE, config);
}

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isConfig(x: Record<string, unknown>): boolean {
  const daysOk =
    Array.isArray(x.days) &&
    x.days.length > 0 &&
    x.days.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6);
  return (
    typeof x.enabled === "boolean" &&
    typeof x.time === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) &&
    daysOk &&
    typeof x.tz === "string" &&
    validTz(x.tz) &&
    (x.lastSent === null || (typeof x.lastSent === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.lastSent)))
  );
}

// ---------- time in the chosen time zone ----------

function timeToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function localParts(tz: string, d: Date = new Date()): { date: string; minutes: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) {
    p[part.type] = part.value;
  }
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
    weekday,
  };
}

function clock(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

// ---------- what goes into the message ----------

type TaskLike = { title: string; done: boolean; due?: string | null; dueTime?: string | null; priority?: string };
type HabitLike = { title?: unknown; days?: unknown };
const PRIORITY: Record<string, number> = { urgent: 0, medium: 1, normal: 2 };

function short(s: string): string {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s;
}

function snapshots(): Record<string, unknown> {
  return getSnapshots() as unknown as Record<string, unknown>;
}

function phoneReady(): boolean {
  const n = snapshots().notify as { enabled?: boolean; ready?: boolean } | undefined;
  return n !== undefined && n !== null && n.enabled === true && n.ready === true;
}

function habitsLeft(today: string): string[] {
  const list = snapshots().habits;
  if (!Array.isArray(list)) {
    return [];
  }
  return (list as HabitLike[])
    .filter((h) => typeof h.title === "string" && Array.isArray(h.days) && !(h.days as unknown[]).includes(today))
    .map((h) => String(h.title));
}

export function buildBrief(cfg: Config, current: Date = new Date()): { title: string; message: string } {
  const now = localParts(cfg.tz, current);
  const today = now.date;
  const open = (tasks as unknown as TaskLike[]).filter((t) => !t.done);

  const dueToday = open
    .filter((t) => t.due === today)
    .sort(
      (a, b) =>
        (PRIORITY[a.priority ?? "normal"] ?? 2) - (PRIORITY[b.priority ?? "normal"] ?? 2) ||
        (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99")
    );
  const overdue = open
    .filter((t) => typeof t.due === "string" && t.due !== "" && t.due < today)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const habits = habitsLeft(today);
  const rems = reminders
    .filter((r) => r.status === "pending" && localParts(cfg.tz, new Date(r.at)).date === today)
    .sort((a, b) => a.at.localeCompare(b.at));

  const lines: string[] = [];
  if (dueToday.length > 0) {
    lines.push(`📋 مهام اليوم (${dueToday.length}):`);
    for (const t of dueToday.slice(0, MAX_TASKS)) {
      lines.push(`• ${short(t.title)}${t.dueTime ? ` (${t.dueTime})` : ""}`);
    }
    if (dueToday.length > MAX_TASKS) {
      lines.push(`… و${dueToday.length - MAX_TASKS} أخرى`);
    }
  }
  if (overdue.length > 0) {
    lines.push(`⚠️ متأخرة (${overdue.length}): ${overdue.slice(0, 3).map((t) => short(t.title)).join("، ")}`);
  }
  if (habits.length > 0) {
    lines.push(`🔥 عادات ما سجلتها بعد (${habits.length}): ${habits.slice(0, 5).map(short).join("، ")}`);
  }
  for (const r of rems.slice(0, 2)) {
    lines.push(`⏰ ${clock(new Date(r.at), cfg.tz)}  ${short(r.text)}`);
  }
  if (lines.length === 0) {
    lines.push("ما عندك شي اليوم. يوم هادي ☀️");
  }
  return { title: `☀️ ملخص الصباح — ${DAY_NAMES[now.weekday]}`, message: lines.join("\n") };
}

function noticeFor(cfg: Config): Notice {
  const b = buildBrief(cfg);
  return { title: b.title, message: b.message, priority: 3, tags: ["sunrise"] };
}

// ---------- the job: checks every few seconds if it is time ----------

function tick(): Result | null {
  if (pendingTest) {
    pendingTest = false;
    return {
      ok: true,
      lines: ["[BRIEF] تجربة الملخص أُرسلت للهاتف."],
      logs: [{ action: "brief.test", detail: "sent", ok: true, actor: "anzu" }],
      notices: [noticeFor(config)],
    };
  }
  if (!config.enabled) {
    return null;
  }
  const now = localParts(config.tz);
  if (!config.days.includes(now.weekday) || config.lastSent === now.date) {
    return null;
  }
  const at = timeToMin(config.time);
  if (now.minutes < at || now.minutes - at > CATCH_UP_MIN) {
    return null;
  }
  if (!phoneReady()) {
    if (warnedDate === now.date) {
      return null;
    }
    warnedDate = now.date;
    return {
      ok: false,
      lines: ["[BRIEF] ملخص الصباح جاهز، لكن إشعارات الهاتف مو مفعّلة فما اكدر أرسله."],
      logs: [{ action: "brief.send", detail: "phone notifications are not ready", ok: false, actor: "anzu" }],
    };
  }
  config.lastSent = now.date; // mark first, so a failed save can never cause repeated messages
  const logs: LogInfo[] = [
    { action: "brief.send", detail: `${DAY_NAMES[now.weekday]} ${config.time}`, ok: true, actor: "anzu" },
  ];
  if (!saveConfig()) {
    logs.push({ action: "brief.save", detail: "could not save the sent state", ok: false, actor: "anzu" });
  }
  return { ok: true, lines: ["[BRIEF] ملخص الصباح أُرسل للهاتف."], logs, notices: [noticeFor(config)] };
}

const briefJob: Job = {
  name: "brief",
  everyMs: CHECK_EVERY_MS,
  run: tick,
};

// ---------- commands (the Settings page uses these) ----------

function update(apply: (c: Config) => void, lines: string[], action: string): Result {
  const previous: Config = { ...config, days: [...config.days] };
  apply(config);
  if (saveConfig()) {
    return { ok: true, lines, logs: [{ action, detail: lines[0], ok: true }] };
  }
  config = previous;
  return {
    ok: false,
    lines: ["ما قدرت أحفظ الإعدادات. ما تغيّر شي."],
    logs: [{ action, detail: "could not save", ok: false }],
  };
}

function daysText(days: number[]): string {
  return days.length === 7 ? "كل الأيام" : days.map((d) => DAY_NAMES[d]).join("، ");
}

function statusResult(): Result {
  return say(
    `ملخص الصباح: ${config.enabled ? "مفعّل" : "متوقف"}`,
    `الساعة: ${config.time} (${config.tz})`,
    `الأيام: ${daysText(config.days)}`,
    phoneReady() ? "إشعارات الهاتف: جاهزة" : "إشعارات الهاتف: مو مفعّلة (الملخص يوصل عن طريقها)",
    "الأوامر: brief on | off | time HH:MM | days 0,1,2 | tz <المنطقة> | test"
  );
}

export const briefModule: Module = {
  name: "brief",
  init: () => {
    const loaded = readJsonObject(CONFIG_FILE);
    if (loaded === null || (loaded !== undefined && !isConfig(loaded))) {
      return [
        "brief.json is damaged.",
        "I stopped so I do not overwrite it.",
        "Fix it or rename it, then run me again.",
      ];
    }
    if (loaded !== undefined) {
      config = {
        enabled: loaded.enabled as boolean,
        time: loaded.time as string,
        days: [...(loaded.days as number[])],
        tz: loaded.tz as string,
        lastSent: loaded.lastSent as string | null,
      };
    }
    return [];
  },
  jobs: [briefJob],
  snapshot: () => ({
    enabled: config.enabled,
    time: config.time,
    days: [...config.days],
    tz: config.tz,
    lastSent: config.lastSent,
  }),
  commands: [
    {
      name: "brief",
      usage: "brief [on|off|time HH:MM|days 0,1,..|tz <zone>|test]",
      about: "morning brief on your phone (hour and days are yours to choose)",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const now = localParts(config.tz);

        if (first === "") {
          return statusResult();
        }

        if (first === "on") {
          if (config.enabled) {
            return say("ملخص الصباح مفعّل أصلاً.");
          }
          const passed = now.minutes >= timeToMin(config.time);
          return update(
            (c) => {
              c.enabled = true;
              if (passed) {
                c.lastSent = now.date; // today's hour already passed: start from the next day
              }
            },
            [
              passed
                ? `تم تفعيل ملخص الصباح. الساعة ${config.time} فاتت اليوم، فيبدأ من اليوم الجاي.`
                : `تم تفعيل ملخص الصباح، يوصلك الساعة ${config.time}.`,
            ],
            "brief.on"
          );
        }

        if (first === "off") {
          if (!config.enabled) {
            return say("ملخص الصباح متوقف أصلاً.");
          }
          return update((c) => (c.enabled = false), ["تم إيقاف ملخص الصباح."], "brief.off");
        }

        if (first === "time") {
          const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(others);
          if (m === null) {
            return problem("الساعة غلط. استخدم HH:MM، مثلاً: brief time 07:30");
          }
          const time = `${m[1].padStart(2, "0")}:${m[2]}`;
          const passed = config.enabled && now.minutes >= timeToMin(time);
          return update(
            (c) => {
              c.time = time;
              if (passed) {
                c.lastSent = now.date; // do not send right away because of the change
              }
            },
            [
              passed
                ? `تم ضبط الساعة ${time}. فاتت اليوم، فيبدأ من اليوم الجاي.`
                : `تم ضبط الساعة ${time}.`,
            ],
            "brief.time"
          );
        }

        if (first === "days") {
          const parts = others === "all" ? ["0", "1", "2", "3", "4", "5", "6"] : others.split(",").map((s) => s.trim());
          if (parts.length === 0 || !parts.every((p) => /^[0-6]$/.test(p))) {
            return problem("الأيام غلط. استخدم أرقام من 0 إلى 6 (0 = الأحد)، مثلاً: brief days 0,1,2,3,4");
          }
          const days = [...new Set(parts.map(Number))].sort((a, b) => a - b);
          return update((c) => (c.days = days), [`تم ضبط الأيام: ${daysText(days)}.`], "brief.days");
        }

        if (first === "tz") {
          if (others === "" || !validTz(others)) {
            return problem("المنطقة الزمنية غلط. مثال: brief tz Asia/Baghdad");
          }
          return update((c) => (c.tz = others), [`تم ضبط المنطقة الزمنية: ${others}.`], "brief.tz");
        }

        if (first === "test") {
          if (!phoneReady()) {
            return problem("إشعارات الهاتف مو مفعّلة. فعّلها أولاً من قسم PHONE (notify setup ثم notify on).");
          }
          pendingTest = true;
          return {
            ok: true,
            lines: ["تمام، تجربة الملخص راح توصلك على الهاتف خلال ثواني."],
            logs: [{ action: "brief.test", detail: "queued", ok: true }],
          };
        }

        return problem("ما فهمت. اكتب: brief  أو  brief on | off | time HH:MM | days 0,1,2 | tz <zone> | test");
      },
    },
  ],
};
