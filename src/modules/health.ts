import type { LogInfo, Module, Result } from "../core/types";
import { nextIdFor, readJsonArray, readJsonObject, saveJsonArray, saveJsonObject } from "../core/storage";
import { problem, say } from "../core/result";
import { splitFirst } from "../core/parse";
import { DataDamaged, damagedLines, perUserArray, perUserObject } from "../core/userctx";

// Health: water, sleep, workouts, mood and energy, meals. Everything is a quick log.
// Each user has their OWN files (health.json and health-profile.json in their own folder).
//
// Targets (water, sleep, calories, protein, workout minutes) are ESTIMATES worked out from the
// person's age, height and weight when they are known, with default values otherwise. The user can
// change any of them. This is general information, not medical advice.
//
// Safety rules built in:
//  - the default calorie target is "maintenance", never a weight-loss target;
//  - no calorie target below MIN_GOAL_KCAL is accepted, and no weight goals or weight history exist;
//  - under 18: no calorie or protein targets and no calorie logging (water and sleep only);
//  - the activity list on the page never shows the numbers (only "health.water").

const ENTRIES_FILE = "health.json";
const PROFILE_FILE = "health-profile.json";
const MAX_ENTRIES = 3000;
const DAYS_IN_SNAPSHOT = 14;
const ENTRIES_IN_SNAPSHOT = 80;
const MIN_GOAL_KCAL = 1200; // we never accept a lower calorie goal
const MIN_AUTO_KCAL = 1400; // and the automatic estimate is never lower than this

type Kind = "water" | "sleep" | "workout" | "mood" | "meal";
const KINDS: Kind[] = ["water", "sleep", "workout", "mood", "meal"];
const SLOT_WORDS: Record<string, string> = {
  فطور: "breakfast", الفطور: "breakfast", breakfast: "breakfast",
  غداء: "lunch", الغداء: "lunch", lunch: "lunch",
  عشاء: "dinner", العشاء: "dinner", dinner: "dinner",
  سناك: "snack", وجبة: "snack", snack: "snack",
};

type Entry = {
  id: number;
  type: Kind;
  date: string; // YYYY-MM-DD in the user's time zone
  time: string; // ISO time (UTC) when it was logged
  ml?: number; // water
  start?: string; end?: string; minutes?: number; quality?: number; // sleep (minutes = time asleep)
  kind?: string; intensity?: number; // workout (minutes is used here too)
  mood?: number; energy?: number; note?: string; // mood
  slot?: string; text?: string; kcal?: number; protein?: number; // meal
};

type Sex = "male" | "female";
type Profile = {
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  sex: Sex | null; // optional: the person chooses
  activity: number; // 1 low, 2 light, 3 moderate, 4 high
  cupMl: number;
  tz: string;
  goalWaterMl: number | null; // null = automatic
  goalSleepMin: number | null;
  goalKcal: number | null;
  goalProtein: number | null;
  goalWorkoutMin: number | null; // per week
};

function defaultProfile(): Profile {
  return {
    age: null, heightCm: null, weightKg: null, sex: null, activity: 2, cupMl: 250, tz: "Asia/Baghdad",
    goalWaterMl: null, goalSleepMin: null, goalKcal: null, goalProtein: null, goalWorkoutMin: null,
  };
}

// ---------- files (one set per user) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEntry(x: unknown): x is Entry {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" && typeof o.type === "string" && (KINDS as string[]).includes(o.type) &&
    typeof o.date === "string" && DATE_RE.test(o.date) && typeof o.time === "string"
  );
}

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const numOrNull = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));

function isProfile(x: Record<string, unknown>): boolean {
  return (
    numOrNull(x.age) && numOrNull(x.heightCm) && numOrNull(x.weightKg) &&
    (x.sex === null || x.sex === "male" || x.sex === "female") &&
    typeof x.activity === "number" && x.activity >= 1 && x.activity <= 4 &&
    typeof x.cupMl === "number" && typeof x.tz === "string" && validTz(x.tz) &&
    numOrNull(x.goalWaterMl) && numOrNull(x.goalSleepMin) && numOrNull(x.goalKcal) &&
    numOrNull(x.goalProtein) && numOrNull(x.goalWorkoutMin)
  );
}

const entries: Entry[] = perUserArray<Entry>(() => {
  const loaded = readJsonArray<unknown>(ENTRIES_FILE);
  if (loaded === null || !loaded.every(isEntry)) {
    throw new DataDamaged(["health.json is damaged.", "I stopped so I do not overwrite it.", "Fix it or rename it, then run me again."]);
  }
  return loaded as Entry[];
});

const profile: Profile = perUserObject<Profile>(() => {
  const loaded = readJsonObject(PROFILE_FILE);
  if (loaded === null || (loaded !== undefined && !isProfile(loaded))) {
    throw new DataDamaged(["health-profile.json is damaged.", "I stopped so I do not overwrite it.", "Fix it or rename it, then run me again."]);
  }
  return loaded === undefined ? defaultProfile() : ({ ...defaultProfile(), ...(loaded as unknown as Profile) });
});

function saveEntries(): boolean {
  return saveJsonArray(ENTRIES_FILE, entries);
}
function saveProfile(): boolean {
  return saveJsonObject(PROFILE_FILE, profile);
}

// ---------- dates in the user's time zone ----------

function localParts(tz: string, d: Date = new Date()): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) {
    p[part.type] = part.value;
  }
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

function today(): string {
  return localParts(profile.tz).date;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function lastDays(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(addDays(end, -i));
  }
  return out;
}

// ---------- targets (estimates) ----------

const ACTIVITY = [0, 1.2, 1.375, 1.55, 1.725];
const ACTIVITY_NAMES = ["", "قليل", "خفيف", "متوسط", "عالي"];

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const round = (v: number, step: number): number => Math.round(v / step) * step;

function sleepByAge(age: number | null): number {
  if (age === null) return 480;
  if (age < 14) return 600;
  if (age < 18) return 540;
  if (age < 65) return 480;
  return 450;
}

export type Targets = {
  waterMl: number; sleepMin: number; kcal: number | null; protein: number | null; workoutMin: number;
  minor: boolean; auto: { water: boolean; sleep: boolean; kcal: boolean; protein: boolean; workout: boolean };
};

function targetsOf(p: Profile): Targets {
  const minor = p.age !== null && p.age < 18;
  const waterAuto = p.weightKg === null ? 2000 : clamp(round(p.weightKg * 33, 50), 1500, 4000);
  let kcalAuto: number | null = null;
  if (!minor && p.age !== null && p.heightCm !== null && p.weightKg !== null) {
    // Mifflin-St Jeor; when the person did not say male/female we use the average of the two
    const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
    const bmr = base + (p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78);
    kcalAuto = Math.max(MIN_AUTO_KCAL, round(bmr * ACTIVITY[p.activity], 50)); // maintenance
  }
  const proteinAuto = !minor && p.weightKg !== null ? round(p.weightKg * 1.2, 5) : null;
  return {
    waterMl: p.goalWaterMl ?? waterAuto,
    sleepMin: p.goalSleepMin ?? sleepByAge(p.age),
    kcal: minor ? null : p.goalKcal ?? kcalAuto,
    protein: minor ? null : p.goalProtein ?? proteinAuto,
    workoutMin: p.goalWorkoutMin ?? (minor ? 420 : 150),
    minor,
    auto: {
      water: p.goalWaterMl === null, sleep: p.goalSleepMin === null, kcal: p.goalKcal === null,
      protein: p.goalProtein === null, workout: p.goalWorkoutMin === null,
    },
  };
}

// ---------- a day, summed up ----------

type Day = {
  date: string; waterMl: number; sleepMin: number | null; sleepQ: number | null; workoutMin: number;
  mood: number | null; energy: number | null; kcal: number; protein: number; meals: number;
};

function daySummary(date: string): Day {
  const list = entries.filter((e) => e.date === date);
  const sum = (k: "ml" | "minutes" | "kcal" | "protein", type: Kind): number =>
    list.filter((e) => e.type === type).reduce((a, e) => a + (e[k] ?? 0), 0);
  const avg = (k: "mood" | "energy"): number | null => {
    const v = list.filter((e) => e.type === "mood" && typeof e[k] === "number").map((e) => e[k] as number);
    return v.length === 0 ? null : Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) / 10;
  };
  const sleep = list.filter((e) => e.type === "sleep").pop();
  return {
    date,
    waterMl: sum("ml", "water"),
    sleepMin: sleep?.minutes ?? null,
    sleepQ: sleep?.quality ?? null,
    workoutMin: sum("minutes", "workout"),
    mood: avg("mood"),
    energy: avg("energy"),
    kcal: sum("kcal", "meal"),
    protein: sum("protein", "meal"),
    meals: list.filter((e) => e.type === "meal").length,
  };
}

// ---------- small helpers for the commands ----------

function logOf(action: string): LogInfo[] {
  return [{ action, detail: "", ok: true }]; // never the numbers: the activity list is visible on the page
}

function done(lines: string[], action: string): Result {
  return { ok: true, lines, logs: logOf(action) };
}

function failedSave(action: string): Result {
  return { ok: false, lines: ["ما قدرت أحفظ التغيير. ما تغيّر شي."], logs: [{ action, detail: "could not save", ok: false }] };
}

function addEntry(e: Omit<Entry, "id" | "time">): Entry | null {
  const full: Entry = { ...e, id: nextIdFor(entries), time: new Date().toISOString() };
  entries.push(full);
  if (saveEntries()) {
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
      saveEntries();
    }
    return full;
  }
  entries.pop();
  return null;
}

const isNum = (s: string): boolean => /^\d+(\.\d+)?$/.test(s);
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------- the commands ----------

function waterCmd(rest: string): Result {
  const { first, others } = splitFirst(rest);
  const t = today();
  if (first === "undo") {
    const last = [...entries].reverse().find((e) => e.type === "water" && e.date === t);
    if (last === undefined) {
      return say("ما اكو ماء مسجل اليوم تلغيه.");
    }
    const index = entries.indexOf(last);
    entries.splice(index, 1);
    if (saveEntries()) {
      return done(["تم إلغاء آخر تسجيل ماء."], "health.water");
    }
    entries.splice(index, 0, last);
    return failedSave("health.water");
  }
  let ml: number;
  if (first === "ml") {
    ml = Number(others);
    if (!(ml >= 50 && ml <= 3000)) {
      return problem("الكمية غلط. استخدم مل من 50 إلى 3000، مثلاً: water ml 500");
    }
  } else {
    const cups = first === "" ? 1 : Number(first);
    if (!(cups > 0 && cups <= 20)) {
      return problem("العدد غلط. اكتب عدد الكاسات (مثلاً: water 2) أو water ml 500");
    }
    ml = Math.round(cups * profile.cupMl);
  }
  if (addEntry({ type: "water", date: t, ml }) === null) {
    return failedSave("health.water");
  }
  const total = daySummary(t).waterMl;
  const goal = targetsOf(profile).waterMl;
  return done([`تم تسجيل ${ml} مل. اليوم ${total} من ${goal} مل (${Math.round((100 * total) / goal)}%).`], "health.water");
}

function sleepCmd(rest: string): Result {
  const parts = rest.split(/\s+/).filter((p) => p !== "");
  let minutes: number;
  let start: string | undefined;
  let end: string | undefined;
  let q: string | undefined;
  const a = TIME_RE.exec(parts[0] ?? "");
  const b = TIME_RE.exec(parts[1] ?? "");
  if (a !== null && b !== null) {
    start = `${a[1].padStart(2, "0")}:${a[2]}`;
    end = `${b[1].padStart(2, "0")}:${b[2]}`;
    minutes = (Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2])) + 1440) % 1440;
    q = parts[2];
  } else if (parts.length >= 1 && isNum(parts[0])) {
    minutes = Math.round(Number(parts[0]) * 60);
    q = parts[1];
  } else {
    return problem("استخدم: sleep <وقت النوم> <وقت الاستيقاظ> [جودة 1-5]  مثل: sleep 23:30 07:00 4", "أو بالساعات: sleep 7.5 4");
  }
  if (!(minutes >= 30 && minutes <= 1080)) {
    return problem("مدة النوم غير منطقية (من نص ساعة إلى 18 ساعة).");
  }
  let quality: number | undefined;
  if (q !== undefined) {
    quality = Number(q);
    if (!Number.isInteger(quality) || quality < 1 || quality > 5) {
      return problem("جودة النوم من 1 إلى 5.");
    }
  }
  const t = today();
  // one sleep entry per day: a new one replaces the old one
  const index = entries.findIndex((e) => e.type === "sleep" && e.date === t);
  const old = index === -1 ? undefined : entries[index];
  if (old !== undefined) {
    entries.splice(index, 1);
  }
  if (addEntry({ type: "sleep", date: t, minutes, ...(start ? { start, end } : {}), ...(quality ? { quality } : {}) }) === null) {
    if (old !== undefined) {
      entries.splice(index, 0, old);
    }
    return failedSave("health.sleep");
  }
  const goal = targetsOf(profile).sleepMin;
  return done([`تم تسجيل النوم: ${hm(minutes)} ساعة (هدفك ${hm(goal)}).${old ? " (حدّثت نوم اليوم)" : ""}`], "health.sleep");
}

function workoutCmd(rest: string): Result {
  const tokens = rest.split(/\s+/).filter((p) => p !== "");
  const at = tokens.findIndex((tk) => isNum(tk));
  if (at === -1) {
    return problem("استخدم: workout <النوع> <الدقائق> [شدة 1-3]  مثل: workout جري 30 2");
  }
  const kind = tokens.slice(0, at).join(" ").slice(0, 40) || "تمرين";
  const minutes = Number(tokens[at]);
  const intensity = tokens[at + 1] === undefined ? 2 : Number(tokens[at + 1]);
  if (!(minutes >= 1 && minutes <= 600)) {
    return problem("مدة التمرين من 1 إلى 600 دقيقة.");
  }
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3) {
    return problem("الشدة من 1 (خفيف) إلى 3 (قوي).");
  }
  if (addEntry({ type: "workout", date: today(), kind, minutes: Math.round(minutes), intensity }) === null) {
    return failedSave("health.workout");
  }
  const week = lastDays(today(), 7).reduce((a, d) => a + daySummary(d).workoutMin, 0);
  return done([`تم تسجيل التمرين: ${kind} ${Math.round(minutes)} دقيقة. هالأسبوع ${week} من ${targetsOf(profile).workoutMin} دقيقة.`], "health.workout");
}

function moodCmd(rest: string): Result {
  const tokens = rest.split(/\s+/).filter((p) => p !== "");
  const mood = Number(tokens[0]);
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) {
    return problem("استخدم: mood <مزاج 1-5> [طاقة 1-5] [ملاحظة]  مثل: mood 4 3 مرتاح");
  }
  let energy: number | undefined;
  let noteFrom = 1;
  if (tokens[1] !== undefined && /^[1-5]$/.test(tokens[1])) {
    energy = Number(tokens[1]);
    noteFrom = 2;
  }
  const note = tokens.slice(noteFrom).join(" ").slice(0, 200);
  const e: Omit<Entry, "id" | "time"> = { type: "mood", date: today(), mood, ...(energy ? { energy } : {}), ...(note ? { note } : {}) };
  if (addEntry(e) === null) {
    return failedSave("health.mood");
  }
  return done(["تم تسجيل مزاجك" + (energy ? " وطاقتك" : "") + "."], "health.mood");
}

function mealCmd(rest: string): Result {
  const minor = targetsOf(profile).minor;
  const tokens = rest.split(/\s+/).filter((p) => p !== "");
  let kcal: number | undefined;
  let protein: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase();
    if ((w === "kcal" || w === "سعرة" || w === "سعرات") && isNum(tokens[i + 1] ?? "")) {
      kcal = Number(tokens[++i]);
    } else if ((w === "protein" || w === "بروتين") && isNum(tokens[i + 1] ?? "")) {
      protein = Number(tokens[++i]);
    } else {
      words.push(tokens[i]);
    }
  }
  let slot = "";
  if (words.length > 0 && SLOT_WORDS[words[0].toLowerCase()] !== undefined) {
    slot = SLOT_WORDS[words[0].toLowerCase()];
    words.shift();
  } else {
    const h = Math.floor(localParts(profile.tz).minutes / 60);
    slot = h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack";
  }
  const text = words.join(" ").slice(0, 80);
  if (text === "") {
    return problem("استخدم: meal [فطور|غداء|عشاء|سناك] <شنو أكلت> [kcal N] [protein N]", "مثل: meal فطور صمون وبيض kcal 450 protein 25");
  }
  if (minor && (kcal !== undefined || protein !== undefined)) {
    return problem("تتبع السعرات والبروتين متاح للبالغين بس. سجّل الوجبة بالاسم بدون أرقام.");
  }
  if ((kcal !== undefined && kcal > 5000) || (protein !== undefined && protein > 400)) {
    return problem("الرقم كبير مرة. تأكد منه.");
  }
  const e: Omit<Entry, "id" | "time"> = {
    type: "meal", date: today(), slot, text, ...(kcal !== undefined ? { kcal: Math.round(kcal) } : {}), ...(protein !== undefined ? { protein: Math.round(protein) } : {}),
  };
  if (addEntry(e) === null) {
    return failedSave("health.meal");
  }
  const d = daySummary(today());
  const goal = targetsOf(profile).kcal;
  return done([`تم تسجيل الوجبة: ${text}.${goal !== null && d.kcal > 0 ? ` اليوم ${d.kcal} من ${goal} سعرة (تقدير).` : ""}`], "health.meal");
}

// ---------- "health ...": summary, profile, goals, delete ----------

function summaryLines(date: string): string[] {
  const d = daySummary(date);
  const t = targetsOf(profile);
  const lines = [
    `💧 الماء: ${d.waterMl} / ${t.waterMl} مل`,
    `😴 النوم: ${d.sleepMin === null ? "ما سجلت" : `${hm(d.sleepMin)} / ${hm(t.sleepMin)}`}`,
    `🏃 التمارين: ${d.workoutMin} دقيقة`,
    `🙂 المزاج: ${d.mood ?? "-"} · الطاقة: ${d.energy ?? "-"}`,
  ];
  if (t.kcal !== null) {
    lines.push(`🍽 الغذاء: ${d.kcal} / ${t.kcal} سعرة (تقدير) · بروتين ${d.protein}${t.protein !== null ? ` / ${t.protein}` : ""} غ`);
  } else {
    lines.push(`🍽 الوجبات: ${d.meals}`);
  }
  return lines;
}

function profileLines(): string[] {
  const t = targetsOf(profile);
  const v = (x: number | null, u = ""): string => (x === null ? "غير محدد" : `${x}${u}`);
  return [
    `العمر: ${v(profile.age)} · الطول: ${v(profile.heightCm, " سم")} · الوزن: ${v(profile.weightKg, " كغ")} · الجنس: ${profile.sex === null ? "غير محدد" : profile.sex === "male" ? "ذكر" : "أنثى"}`,
    `النشاط: ${ACTIVITY_NAMES[profile.activity]} · الكاسة: ${profile.cupMl} مل · المنطقة الزمنية: ${profile.tz}`,
    `الأهداف (تقديرات عامة مو نصيحة طبية): ماء ${t.waterMl} مل${t.auto.water ? " (تلقائي)" : ""} · نوم ${hm(t.sleepMin)}${t.auto.sleep ? " (تلقائي)" : ""} · ` +
      (t.kcal === null ? "سعرات: تحتاج العمر والطول والوزن (للبالغين)" : `سعرات ${t.kcal}${t.auto.kcal ? " (تلقائي)" : ""} · بروتين ${v(t.protein, " غ")}`) +
      ` · تمارين ${t.workoutMin} دقيقة/أسبوع`,
  ];
}

// key=value pairs: "age=18 height=175" (a value of "auto"/"none" clears it)
function pairs(text: string): Map<string, string> | string {
  const out = new Map<string, string>();
  for (const part of text.split(/\s+/).filter((p) => p !== "")) {
    const i = part.indexOf("=");
    if (i < 1) {
      return `ما فهمت "${part}". استخدم شكل key=value`;
    }
    out.set(part.slice(0, i).toLowerCase(), part.slice(i + 1));
  }
  return out;
}

const clearing = (v: string): boolean => v === "" || v === "auto" || v === "none" || v === "-";

function saveCmd(text: string): Result {
  const kv = pairs(text);
  if (typeof kv === "string") {
    return problem(kv);
  }
  const next: Profile = { ...profile };
  for (const [k, v] of kv) {
    const n = Number(v);
    if (k === "age") {
      if (clearing(v)) next.age = null;
      else if (Number.isInteger(n) && n >= 8 && n <= 110) next.age = n;
      else return problem("العمر من 8 إلى 110.");
    } else if (k === "height") {
      if (clearing(v)) next.heightCm = null;
      else if (n >= 80 && n <= 250) next.heightCm = Math.round(n);
      else return problem("الطول بالسم من 80 إلى 250.");
    } else if (k === "weight") {
      if (clearing(v)) next.weightKg = null;
      else if (n >= 20 && n <= 300) next.weightKg = Math.round(n * 10) / 10;
      else return problem("الوزن بالكيلو من 20 إلى 300.");
    } else if (k === "sex") {
      if (clearing(v)) next.sex = null;
      else if (v === "male" || v === "female") next.sex = v;
      else return problem("الجنس: male أو female أو none (اختياري).");
    } else if (k === "activity") {
      if (Number.isInteger(n) && n >= 1 && n <= 4) next.activity = n;
      else return problem("النشاط من 1 (قليل) إلى 4 (عالي).");
    } else if (k === "cup") {
      if (n >= 100 && n <= 1000) next.cupMl = Math.round(n);
      else return problem("حجم الكاسة من 100 إلى 1000 مل.");
    } else if (k === "tz") {
      if (validTz(v)) next.tz = v;
      else return problem("المنطقة الزمنية غلط. مثال: tz=Asia/Baghdad");
    } else {
      return problem(`حقل غير معروف: ${k}. المتاح: age height weight sex activity cup tz`);
    }
  }
  const old = { ...profile };
  Object.assign(profile, next);
  if (saveProfile()) {
    return done(["تم حفظ ملفك الصحي. الأهداف التلقائية انحسبت من جديد."], "health.profile");
  }
  Object.assign(profile, old);
  return failedSave("health.profile");
}

function goalCmd(text: string): Result {
  const kv = pairs(text);
  if (typeof kv === "string") {
    return problem(kv);
  }
  const next: Profile = { ...profile };
  for (const [k, v] of kv) {
    const n = Number(v);
    const reset = clearing(v);
    if (k === "water") {
      if (reset) next.goalWaterMl = null;
      else if (n >= 500 && n <= 8000) next.goalWaterMl = Math.round(n);
      else return problem("هدف الماء من 500 إلى 8000 مل.");
    } else if (k === "sleep") {
      if (reset) next.goalSleepMin = null;
      else if (n >= 3 && n <= 14) next.goalSleepMin = Math.round(n * 60);
      else return problem("هدف النوم بالساعات من 3 إلى 14.");
    } else if (k === "kcal") {
      if (reset) next.goalKcal = null;
      else if (n >= MIN_GOAL_KCAL && n <= 6000) next.goalKcal = Math.round(n);
      else return problem(`هدف السعرات من ${MIN_GOAL_KCAL} إلى 6000. ما أقبل أقل من هذا حتى ما نسوي هدف غير آمن.`);
    } else if (k === "protein") {
      if (reset) next.goalProtein = null;
      else if (n >= 20 && n <= 400) next.goalProtein = Math.round(n);
      else return problem("هدف البروتين من 20 إلى 400 غرام.");
    } else if (k === "workout") {
      if (reset) next.goalWorkoutMin = null;
      else if (n >= 0 && n <= 1500) next.goalWorkoutMin = Math.round(n);
      else return problem("هدف التمارين بالدقائق بالأسبوع من 0 إلى 1500.");
    } else {
      return problem(`هدف غير معروف: ${k}. المتاح: water sleep kcal protein workout (وقيمة auto ترجعه تلقائي)`);
    }
  }
  const old = { ...profile };
  Object.assign(profile, next);
  if (saveProfile()) {
    return done(["تم حفظ الأهداف."], "health.goal");
  }
  Object.assign(profile, old);
  return failedSave("health.goal");
}

function deleteCmd(text: string): Result {
  const id = Number(text);
  const index = entries.findIndex((e) => e.id === id);
  if (!Number.isInteger(id) || index === -1) {
    return problem("ما لقيت هذا التسجيل.");
  }
  const [removed] = entries.splice(index, 1);
  if (saveEntries()) {
    return done(["تم حذف التسجيل."], "health.delete");
  }
  entries.splice(index, 0, removed);
  return failedSave("health.delete");
}

function healthCmd(rest: string): Result {
  const { first, others } = splitFirst(rest);
  if (first === "") {
    return say("صحتك اليوم:", ...summaryLines(today()));
  }
  if (first === "week") {
    const week = lastDays(today(), 7).map(daySummary);
    const mean = (v: number[]): string => (v.length === 0 ? "-" : String(Math.round(v.reduce((x, y) => x + y, 0) / v.length)));
    const moods = week.filter((d) => d.mood !== null).map((d) => d.mood as number);
    return say(
      "آخر 7 أيام (المتوسط اليومي):",
      `💧 الماء: ${mean(week.map((d) => d.waterMl))} مل · 😴 النوم: ${mean(week.filter((d) => d.sleepMin !== null).map((d) => d.sleepMin as number))} دقيقة`,
      `🏃 التمارين: ${week.reduce((x, d) => x + d.workoutMin, 0)} دقيقة بالمجموع · 🙂 المزاج: ${moods.length === 0 ? "-" : (moods.reduce((x, y) => x + y, 0) / moods.length).toFixed(1)}`
    );
  }
  if (first === "profile") {
    return say(...profileLines());
  }
  if (first === "save") {
    return saveCmd(others);
  }
  if (first === "goal") {
    return goalCmd(others);
  }
  if (first === "delete") {
    return deleteCmd(others);
  }
  return problem("ما فهمت. اكتب: health  أو  health week | profile | save age=.. | goal water=.. | delete <رقم>");
}

// ---------- the module ----------

export const healthModule: Module = {
  name: "health",
  init: () => {
    try {
      void entries.length; // checks the owner's files now; other users load when they first use it
      void profile.cupMl;
    } catch (e) {
      return damagedLines(e);
    }
    return [];
  },
  // What the page shows (the user's own data only).
  snapshot: () => {
    const t = today();
    return {
      profile: { ...profile },
      targets: targetsOf(profile),
      today: t,
      activityNames: ACTIVITY_NAMES,
      days: lastDays(t, DAYS_IN_SNAPSHOT).map(daySummary),
      entries: entries.slice(-ENTRIES_IN_SNAPSHOT).reverse(),
    };
  },
  commands: [
    { name: "water", usage: "water [كاسات|ml N|undo]", about: "log water", run: waterCmd },
    { name: "sleep", usage: "sleep <نوم> <استيقاظ> [جودة]", about: "log last night's sleep", run: sleepCmd },
    { name: "workout", usage: "workout <نوع> <دقائق> [شدة]", about: "log a workout", run: workoutCmd },
    { name: "mood", usage: "mood <1-5> [طاقة 1-5] [ملاحظة]", about: "log mood and energy", run: moodCmd },
    { name: "meal", usage: "meal [فطور|غداء|عشاء|سناك] <وصف> [kcal N]", about: "log a meal", run: mealCmd },
    { name: "health", usage: "health [week|profile|save ..|goal ..|delete N]", about: "health summary, profile and goals", run: healthCmd },
  ],
};

