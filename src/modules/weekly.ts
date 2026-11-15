import type { Job, LogInfo, Module, Notice, Result } from "../core/types";
import { readJsonObject, saveJsonObject } from "../core/storage";
import { problem, say } from "../core/result";
import { splitFirst } from "../core/parse";
import { goals, tasks } from "../core/data";
import { readLog } from "../core/log";
import { getSnapshots } from "../core/snapshot";
import { DataDamaged, damagedLines, perUserObject } from "../core/userctx";
import { habits } from "./habits";

// Two messages to your phone, both controlled from the Settings page:
//  1) WEEKLY REPORT: once a week, on the day and hour you choose (default Friday 09:00).
//  2) EVENING NUDGE: once a day, at the hour you choose (default 21:00), ONLY if you still have
//     habits not marked today (or tasks due today that are not done).
// Each user has their own settings (weekly.json in their own folder).

const CONFIG_FILE = "weekly.json";
const CHECK_EVERY_MS = 10_000;
const WEEKLY_CATCH_UP_MIN = 360; // Anzu was off at the chosen hour: still sends within 6 hours
const EVENING_CATCH_UP_MIN = 120;
const MAX_HABITS = 5;
const MAX_GOALS = 3;
const MAX_TEXT = 30;
const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // 0 = Sunday

// How "a task was finished" is written in the activity log. The report counts these lines.
// If your log uses another name, change it here.
const DONE_ACTIONS = /^(task\.done|agent\.tasks?\.(done|complete))$/;

type Config = {
  weeklyOn: boolean;
  weeklyDay: number; // 0 = Sunday ... 6 = Saturday
  weeklyTime: string; // "HH:MM" in tz
  weeklyLast: string | null; // "YYYY-MM-DD": the day it was already handled
  eveningOn: boolean;
  eveningTime: string;
  eveningLast: string | null;
  tz: string;
};

function defaults(): Config {
  return {
    weeklyOn: false, weeklyDay: 5, weeklyTime: "09:00", weeklyLast: null,
    eveningOn: false, eveningTime: "21:00", eveningLast: null,
    tz: "Asia/Baghdad",
  };
}

// ---------- settings (one set per user) ----------

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isConfig(x: Record<string, unknown>): boolean {
  return (
    typeof x.weeklyOn === "boolean" &&
    typeof x.weeklyDay === "number" && Number.isInteger(x.weeklyDay) && x.weeklyDay >= 0 && x.weeklyDay <= 6 &&
    typeof x.weeklyTime === "string" && TIME_RE.test(x.weeklyTime) &&
    (x.weeklyLast === null || (typeof x.weeklyLast === "string" && DATE_RE.test(x.weeklyLast))) &&
    typeof x.eveningOn === "boolean" &&
    typeof x.eveningTime === "string" && TIME_RE.test(x.eveningTime) &&
    (x.eveningLast === null || (typeof x.eveningLast === "string" && DATE_RE.test(x.eveningLast))) &&
    typeof x.tz === "string" && validTz(x.tz)
  );
}

function loadConfigFile(): Config {
  const loaded = readJsonObject(CONFIG_FILE);
  if (loaded === null || (loaded !== undefined && !isConfig(loaded))) {
    throw new DataDamaged([
      "weekly.json is damaged.",
      "I stopped so I do not overwrite it.",
      "Fix it or rename it, then run me again.",
    ]);
  }
  if (loaded === undefined) {
    return defaults();
  }
  return {
    weeklyOn: loaded.weeklyOn as boolean,
    weeklyDay: loaded.weeklyDay as number,
    weeklyTime: loaded.weeklyTime as string,
    weeklyLast: loaded.weeklyLast as string | null,
    eveningOn: loaded.eveningOn as boolean,
    eveningTime: loaded.eveningTime as string,
    eveningLast: loaded.eveningLast as string | null,
    tz: loaded.tz as string,
  };
}

const config: Config = perUserObject<Config>(loadConfigFile);
const flags = perUserObject<{
  weeklyTest: boolean; eveningTest: boolean; warnedWeekly: string | null; warnedEvening: string | null;
}>(() => ({ weeklyTest: false, eveningTest: false, warnedWeekly: null, warnedEvening: null }));

function saveConfig(): boolean {
  return saveJsonObject(CONFIG_FILE, config);
}

// ---------- time in the chosen time zone ----------

function timeToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function localParts(tz: string, d: Date = new Date()): { date: string; minutes: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) {
    p[part.type] = part.value;
  }
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// "2026-11-13" and n=7 -> the 7 dates ending at it (oldest first)
function lastDays(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(addDays(end, -i));
  }
  return out;
}

// ---------- what is in the user's data ----------

type TaskLike = { title: string; done: boolean; due?: string | null; goalId?: number | null; dueTime?: string | null };
type HabitLike = { title: string; days: string[]; created: string };
type GoalLike = { id: number; title: string };

function short(s: string): string {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s;
}

function userHabits(): HabitLike[] {
  return (habits as unknown as Array<Record<string, unknown>>)
    .filter((h) => typeof h.title === "string" && Array.isArray(h.days) && typeof h.created === "string")
    .map((h) => ({ title: h.title as string, days: h.days as string[], created: h.created as string }));
}

function phoneReady(): boolean {
  const n = (getSnapshots() as Record<string, unknown>).notify as { enabled?: boolean; ready?: boolean } | undefined;
  return n !== undefined && n !== null && n.enabled === true && n.ready === true;
}

// tasks finished per day, counted from the activity log (tasks have no "finished on" date)
function doneByDay(tz: string): Map<string, number> {
  const out = new Map<string, number>();
  const log = readLog();
  if (log === null) {
    return out;
  }
  for (const e of log.entries) {
    if (!e.ok || !DONE_ACTIONS.test(e.action)) {
      continue;
    }
    const t = new Date(e.time);
    if (Number.isNaN(t.getTime())) {
      continue;
    }
    const day = localParts(tz, t).date;
    out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

function streakOf(days: string[], today: string): number {
  const set = new Set(days);
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n = n + 1;
    cur = addDays(cur, -1);
  }
  return n;
}

function countIn(days: string[], window: string[]): number {
  const set = new Set(days);
  return window.filter((d) => set.has(d)).length;
}

// ---------- the weekly report ----------

function ravenLine(percent: number, nothing: boolean): string {
  if (nothing) {
    return "🪶 أسبوع هادئ جداً. حتى أنا ما لقيت شي أنعق عليه. نبدأ من جديد.";
  }
  if (percent >= 75) {
    return "🪶 أسبوع ممتاز. هالمرة ما راح أعلّق بسخرية.";
  }
  if (percent >= 40) {
    return "🪶 مو سيئ. بس أنت تكدر أحسن، وأنا أعرف.";
  }
  return "🪶 بداية خجولة. الأسبوع الجاي نحسّنها سوية.";
}

function buildWeekly(cfg: Config, current: Date = new Date()): { title: string; message: string } {
  const today = localParts(cfg.tz, current).date;
  const week = lastDays(today, 7);
  const before = lastDays(addDays(today, -7), 7);

  // tasks
  const doneMap = doneByDay(cfg.tz);
  const sum = (ds: string[]): number => ds.reduce((a, d) => a + (doneMap.get(d) ?? 0), 0);
  const tasksDone = sum(week);
  const tasksBefore = sum(before);
  const list = tasks as unknown as TaskLike[];
  const open = list.filter((t) => !t.done);
  const overdue = open.filter((t) => typeof t.due === "string" && t.due !== "" && t.due < today).length;
  const soon = open.filter((t) => typeof t.due === "string" && t.due >= today && t.due <= addDays(today, 7)).length;

  // habits
  const hs = userHabits();
  let checkins = 0;
  let possible = 0;
  const rows = hs.map((h) => {
    const age = daysBetween(h.created, today) + 1;
    const win = Math.max(1, Math.min(7, Number.isFinite(age) ? age : 1));
    const done = Math.min(win, countIn(h.days, week));
    checkins += done;
    possible += win;
    return { title: h.title, done, win, streak: streakOf(h.days, today) };
  });
  const checkinsBefore = hs.reduce((a, h) => a + countIn(h.days, before), 0);

  // the best day (tasks finished + habits marked)
  let bestDay = "";
  let bestScore = 0;
  for (const d of week) {
    const score = (doneMap.get(d) ?? 0) + hs.filter((h) => h.days.includes(d)).length;
    if (score > bestScore) {
      bestScore = score;
      bestDay = DAY_NAMES[weekdayOf(d)];
    }
  }

  const lines: string[] = [];
  const diff = tasksDone - tasksBefore;
  lines.push(`✅ أنجزت ${tasksDone} مهمة${tasksBefore > 0 || tasksDone > 0 ? ` (${diff >= 0 ? "+" : ""}${diff} عن الأسبوع الماضي)` : ""}`);
  lines.push(`📋 مفتوحة ${open.length} · متأخرة ${overdue} · قادمة هالأسبوع ${soon}`);
  if (rows.length > 0) {
    const cdiff = checkins - checkinsBefore;
    lines.push(`🔥 العادات: ${checkins} تسجيل (${cdiff >= 0 ? "+" : ""}${cdiff})`);
    for (const r of rows.slice(0, MAX_HABITS)) {
      lines.push(`• ${short(r.title)}: ${r.done}/${r.win}${r.streak > 1 ? ` (سلسلة ${r.streak})` : ""}`);
    }
    if (rows.length > MAX_HABITS) {
      lines.push(`… و${rows.length - MAX_HABITS} أخرى`);
    }
  }
  if (bestDay !== "") {
    lines.push(`⭐ أفضل يوم: ${bestDay}`);
  }
  const goalRows = (goals as unknown as GoalLike[])
    .map((g) => {
      const mine = list.filter((t) => t.goalId === g.id);
      return { title: g.title, done: mine.filter((t) => t.done).length, total: mine.length };
    })
    .filter((g) => g.total > 0)
    .slice(0, MAX_GOALS);
  if (goalRows.length > 0) {
    lines.push(`🎯 ${goalRows.map((g) => `${short(g.title)} ${g.done}/${g.total}`).join(" · ")}`);
  }
  const percent = possible > 0 ? Math.round((100 * checkins) / possible) : tasksDone > 0 ? 60 : 0;
  lines.push(ravenLine(percent, tasksDone === 0 && checkins === 0));
  return { title: "📊 تقريرك الأسبوعي", message: lines.join("\n") };
}

// ---------- the evening nudge ----------

function buildEvening(cfg: Config, current: Date = new Date(), force = false): { title: string; message: string } | null {
  const today = localParts(cfg.tz, current).date;
  const habitsLeft = userHabits().filter((h) => !h.days.includes(today)).map((h) => short(h.title));
  const list = tasks as unknown as TaskLike[];
  const tasksLeft = list.filter((t) => !t.done && t.due === today).map((t) => short(t.title));
  const lines: string[] = [];
  if (habitsLeft.length > 0) {
    lines.push(`🔥 ما سجلت: ${habitsLeft.slice(0, MAX_HABITS).join("، ")}${habitsLeft.length > MAX_HABITS ? "…" : ""}`);
  }
  if (tasksLeft.length > 0) {
    lines.push(`📋 مهام اليوم المتبقية (${tasksLeft.length}): ${tasksLeft.slice(0, 3).join("، ")}${tasksLeft.length > 3 ? "…" : ""}`);
  }
  if (lines.length === 0) {
    return force ? { title: "🌙 قبل ما تنام", message: "كل عاداتك ومهام اليوم خالصة ✅ (هذي تجربة)" } : null;
  }
  lines.push("لسه اكو وقت. دقيقتين وتخلص.");
  return { title: "🌙 قبل ما تنام", message: lines.join("\n") };
}

function notice(n: { title: string; message: string }, tag: string): Notice {
  return { title: n.title, message: n.message, priority: 3, tags: [tag] };
}

// ---------- the job: checks every few seconds if it is time ----------

function tick(): Result | null {
  const notices: Notice[] = [];
  const lines: string[] = [];
  const logs: LogInfo[] = [];

  if (flags.weeklyTest) {
    flags.weeklyTest = false;
    notices.push(notice(buildWeekly(config), "bar_chart"));
    lines.push("[WEEKLY] تجربة التقرير الأسبوعي أُرسلت للهاتف.");
    logs.push({ action: "weekly.test", detail: "sent", ok: true, actor: "anzu" });
  }
  if (flags.eveningTest) {
    flags.eveningTest = false;
    const e = buildEvening(config, new Date(), true);
    if (e !== null) {
      notices.push(notice(e, "crescent_moon"));
    }
    lines.push("[EVENING] تجربة التذكير المسائي أُرسلت للهاتف.");
    logs.push({ action: "evening.test", detail: "sent", ok: true, actor: "anzu" });
  }

  const now = localParts(config.tz);

  // weekly report
  if (config.weeklyOn && now.weekday === config.weeklyDay && config.weeklyLast !== now.date) {
    const at = timeToMin(config.weeklyTime);
    if (now.minutes >= at && now.minutes - at <= WEEKLY_CATCH_UP_MIN) {
      if (!phoneReady()) {
        if (flags.warnedWeekly !== now.date) {
          flags.warnedWeekly = now.date;
          lines.push("[WEEKLY] التقرير جاهز، لكن إشعارات الهاتف مو مفعّلة فما اكدر أرسله.");
          logs.push({ action: "weekly.send", detail: "phone notifications are not ready", ok: false, actor: "anzu" });
        }
      } else {
        config.weeklyLast = now.date; // mark first, so a failed save can never cause repeated messages
        notices.push(notice(buildWeekly(config), "bar_chart"));
        lines.push("[WEEKLY] التقرير الأسبوعي أُرسل للهاتف.");
        logs.push({ action: "weekly.send", detail: `${DAY_NAMES[now.weekday]} ${config.weeklyTime}`, ok: true, actor: "anzu" });
        if (!saveConfig()) {
          logs.push({ action: "weekly.save", detail: "could not save the sent state", ok: false, actor: "anzu" });
        }
      }
    }
  }

  // evening nudge
  if (config.eveningOn && config.eveningLast !== now.date) {
    const at = timeToMin(config.eveningTime);
    if (now.minutes >= at && now.minutes - at <= EVENING_CATCH_UP_MIN) {
      if (!phoneReady()) {
        if (flags.warnedEvening !== now.date) {
          flags.warnedEvening = now.date;
          lines.push("[EVENING] التذكير المسائي جاهز، لكن إشعارات الهاتف مو مفعّلة.");
          logs.push({ action: "evening.send", detail: "phone notifications are not ready", ok: false, actor: "anzu" });
        }
      } else {
        config.eveningLast = now.date;
        const e = buildEvening(config);
        if (e !== null) {
          notices.push(notice(e, "crescent_moon"));
          lines.push("[EVENING] التذكير المسائي أُرسل للهاتف.");
          logs.push({ action: "evening.send", detail: config.eveningTime, ok: true, actor: "anzu" });
        }
        if (!saveConfig()) {
          logs.push({ action: "evening.save", detail: "could not save the sent state", ok: false, actor: "anzu" });
        }
      }
    }
  }

  if (notices.length === 0 && lines.length === 0 && logs.length === 0) {
    return null;
  }
  return { ok: true, lines, logs, notices };
}

const weeklyJob: Job = {
  name: "weekly",
  everyMs: CHECK_EVERY_MS,
  run: tick,
};

// ---------- commands (the Settings page uses these) ----------

function update(apply: () => void, line: string, action: string): Result {
  const previous: Config = { ...config };
  apply();
  if (saveConfig()) {
    return { ok: true, lines: [line], logs: [{ action, detail: line, ok: true }] };
  }
  Object.assign(config, previous);
  return {
    ok: false,
    lines: ["ما قدرت أحفظ الإعدادات. ما تغيّر شي."],
    logs: [{ action, detail: "could not save", ok: false }],
  };
}

function parseTime(text: string): string | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  return m === null ? null : `${m[1].padStart(2, "0")}:${m[2]}`;
}

const PHONE_HINT = "إشعارات الهاتف: مو مفعّلة (الرسائل توصل عن طريقها)";

function weeklyStatus(): Result {
  return say(
    `التقرير الأسبوعي: ${config.weeklyOn ? "مفعّل" : "متوقف"}`,
    `اليوم: ${DAY_NAMES[config.weeklyDay]}، الساعة: ${config.weeklyTime} (${config.tz})`,
    phoneReady() ? "إشعارات الهاتف: جاهزة" : PHONE_HINT,
    "الأوامر: weekly on | off | day 0-6 | time HH:MM | tz <المنطقة> | test"
  );
}

function eveningStatus(): Result {
  return say(
    `التذكير المسائي: ${config.eveningOn ? "مفعّل" : "متوقف"}`,
    `الساعة: ${config.eveningTime} (${config.tz})`,
    phoneReady() ? "إشعارات الهاتف: جاهزة" : PHONE_HINT,
    "الأوامر: evening on | off | time HH:MM | test"
  );
}

export const weeklyModule: Module = {
  name: "weekly",
  init: () => {
    try {
      void config.weeklyOn; // checks the owner's file now; other users load when they first use it
    } catch (e) {
      return damagedLines(e);
    }
    return [];
  },
  jobs: [weeklyJob],
  snapshot: () => ({
    weeklyOn: config.weeklyOn,
    weeklyDay: config.weeklyDay,
    weeklyTime: config.weeklyTime,
    eveningOn: config.eveningOn,
    eveningTime: config.eveningTime,
    tz: config.tz,
  }),
  commands: [
    {
      name: "weekly",
      usage: "weekly [on|off|day 0-6|time HH:MM|tz <zone>|test]",
      about: "weekly report on your phone (day and hour are yours to choose)",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const now = localParts(config.tz);
        if (first === "") {
          return weeklyStatus();
        }
        if (first === "on") {
          if (config.weeklyOn) {
            return say("التقرير الأسبوعي مفعّل أصلاً.");
          }
          const passed = now.weekday === config.weeklyDay && now.minutes >= timeToMin(config.weeklyTime);
          return update(
            () => {
              config.weeklyOn = true;
              if (passed) {
                config.weeklyLast = now.date; // this week's hour already passed: start next week
              }
            },
            passed
              ? `تم تفعيل التقرير الأسبوعي. وقت هذا الأسبوع فات، فيبدأ من الأسبوع الجاي (${DAY_NAMES[config.weeklyDay]} ${config.weeklyTime}).`
              : `تم تفعيل التقرير الأسبوعي: ${DAY_NAMES[config.weeklyDay]} الساعة ${config.weeklyTime}.`,
            "weekly.on"
          );
        }
        if (first === "off") {
          if (!config.weeklyOn) {
            return say("التقرير الأسبوعي متوقف أصلاً.");
          }
          return update(() => { config.weeklyOn = false; }, "تم إيقاف التقرير الأسبوعي.", "weekly.off");
        }
        if (first === "day") {
          if (!/^[0-6]$/.test(others)) {
            return problem("اليوم غلط. استخدم رقم من 0 إلى 6 (0 = الأحد)، مثلاً: weekly day 5");
          }
          const day = Number(others);
          const passed = config.weeklyOn && now.weekday === day && now.minutes >= timeToMin(config.weeklyTime);
          return update(
            () => {
              config.weeklyDay = day;
              if (passed) {
                config.weeklyLast = now.date;
              }
            },
            `تم ضبط يوم التقرير: ${DAY_NAMES[day]}.`,
            "weekly.day"
          );
        }
        if (first === "time") {
          const time = parseTime(others);
          if (time === null) {
            return problem("الساعة غلط. استخدم HH:MM، مثلاً: weekly time 09:00");
          }
          const passed = config.weeklyOn && now.weekday === config.weeklyDay && now.minutes >= timeToMin(time);
          return update(
            () => {
              config.weeklyTime = time;
              if (passed) {
                config.weeklyLast = now.date;
              }
            },
            `تم ضبط ساعة التقرير: ${time}.`,
            "weekly.time"
          );
        }
        if (first === "tz") {
          if (others === "" || !validTz(others)) {
            return problem("المنطقة الزمنية غلط. مثال: weekly tz Asia/Baghdad");
          }
          return update(() => { config.tz = others; }, `تم ضبط المنطقة الزمنية: ${others}.`, "weekly.tz");
        }
        if (first === "test") {
          if (!phoneReady()) {
            return problem("إشعارات الهاتف مو مفعّلة. فعّلها أولاً من قسم PHONE (notify setup ثم notify on).");
          }
          flags.weeklyTest = true;
          return {
            ok: true,
            lines: ["تمام، تجربة التقرير راح توصلك على الهاتف خلال ثواني."],
            logs: [{ action: "weekly.test", detail: "queued", ok: true }],
          };
        }
        return problem("ما فهمت. اكتب: weekly  أو  weekly on | off | day 0-6 | time HH:MM | tz <zone> | test");
      },
    },
    {
      name: "evening",
      usage: "evening [on|off|time HH:MM|test]",
      about: "evening nudge: habits not marked yet (hour is yours to choose)",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const now = localParts(config.tz);
        if (first === "") {
          return eveningStatus();
        }
        if (first === "on") {
          if (config.eveningOn) {
            return say("التذكير المسائي مفعّل أصلاً.");
          }
          const passed = now.minutes >= timeToMin(config.eveningTime);
          return update(
            () => {
              config.eveningOn = true;
              if (passed) {
                config.eveningLast = now.date;
              }
            },
            passed
              ? `تم تفعيل التذكير المسائي. الساعة ${config.eveningTime} فاتت اليوم، فيبدأ من بكرة.`
              : `تم تفعيل التذكير المسائي، يوصلك الساعة ${config.eveningTime}.`,
            "evening.on"
          );
        }
        if (first === "off") {
          if (!config.eveningOn) {
            return say("التذكير المسائي متوقف أصلاً.");
          }
          return update(() => { config.eveningOn = false; }, "تم إيقاف التذكير المسائي.", "evening.off");
        }
        if (first === "time") {
          const time = parseTime(others);
          if (time === null) {
            return problem("الساعة غلط. استخدم HH:MM، مثلاً: evening time 21:00");
          }
          const passed = config.eveningOn && now.minutes >= timeToMin(time);
          return update(
            () => {
              config.eveningTime = time;
              if (passed) {
                config.eveningLast = now.date;
              }
            },
            `تم ضبط ساعة التذكير المسائي: ${time}.`,
            "evening.time"
          );
        }
        if (first === "test") {
          if (!phoneReady()) {
            return problem("إشعارات الهاتف مو مفعّلة. فعّلها أولاً من قسم PHONE (notify setup ثم notify on).");
          }
          flags.eveningTest = true;
          return {
            ok: true,
            lines: ["تمام، تجربة التذكير المسائي راح توصلك على الهاتف خلال ثواني."],
            logs: [{ action: "evening.test", detail: "queued", ok: true }],
          };
        }
        return problem("ما فهمت. اكتب: evening  أو  evening on | off | time HH:MM | test");
      },
    },
  ],
};
