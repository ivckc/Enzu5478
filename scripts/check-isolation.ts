// Checks that one user can NOT see or change another user's data.
//
// It creates two temporary accounts, fills the first one with data (tasks, goals, habits,
// reminders), then checks that the second one sees none of it, and deletes the test accounts.
//
// Run (Anzu must be running in ANOTHER terminal):
//   npx tsx --env-file=.env scripts/check-isolation.ts
//
// Optional: BASE_URL=http://localhost:4747 (default)

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE = (process.env.BASE_URL || "http://localhost:4747").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const INVITE = process.env.INVITE_CODE || "";
const DB_PATH = process.env.DATABASE_PATH || "./data/anzu.db";
const DATA_DIR = process.env.ANZU_DATA_DIR || "data";
const PASSWORD = "Iso-Test-Pass-12345";
const tag = Math.random().toString(36).slice(2, 8);

let fails = 0;
let warns = 0;
function pass(msg: string): void { console.log("  ✅ " + msg); }
function fail(msg: string): void { fails++; console.log("  ❌ " + msg); }
function warn(msg: string): void { warns++; console.log("  ⚠️  " + msg); }
function check(cond: boolean, good: string, bad: string): void { cond ? pass(good) : fail(bad); }

type Reply = { code: number; json: any };
type User = { name: string; cookie: string; id: string };

async function getToken(): Promise<string> {
  const r = await fetch(`${BASE}/anzu-voice.js`);
  const text = await r.text();
  const m = /var TOKEN = "([0-9a-f]{32})"/.exec(text);
  if (!m) throw new Error("ما لقيت التوكن بصفحة أنزو. هل أنزو شغّال؟ وهل الرابط صحيح؟");
  return m[1];
}

async function register(name: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ username: name, password: PASSWORD, inviteCode: INVITE }),
  });
  if (r.status !== 201) throw new Error(`التسجيل فشل (${r.status}): ${await r.text()}`);
  const cookies: string[] = (r.headers as any).getSetCookie ? (r.headers as any).getSetCookie() : [String(r.headers.get("set-cookie") || "")];
  const c = cookies.map((x) => x.split(";")[0]).find((x) => x.startsWith("anzu_token="));
  if (!c) throw new Error("ما رجع كوكي تسجيل الدخول");
  return c;
}

let TOKEN = "";
async function api(u: User, method: string, url: string, body?: unknown): Promise<Reply> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: u.cookie, "x-anzu-token": TOKEN },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: r.status, json };
}
const run = (u: User, text: string) => api(u, "POST", "/api/command", { text });
const out = (r: Reply): string => (r.json && Array.isArray(r.json.lines) ? r.json.lines.join("\n") : JSON.stringify(r.json));

// Does this value contain anything of A's test data?
const leaks = (v: unknown): boolean =>
  ["TASK", "GOAL", "HABIT", "REM"].some((k) => (typeof v === "string" ? v : JSON.stringify(v)).includes(`ISO${k}${tag}`));

function filesText(dir: string): string {
  let all = "";
  if (!fs.existsSync(dir)) return all;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) all += fs.readFileSync(p, "utf8");
  }
  return all;
}

async function main(): Promise<void> {
  console.log(`\nفحص عزل المستخدمين على ${BASE}\n`);
  if (!INVITE) throw new Error("INVITE_CODE غير موجود. شغّل السكربت مع --env-file=.env");
  const db = new Database(DB_PATH);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count === 0 && !process.env.ANZU_OWNER_USERNAME) {
    throw new Error("ما اكو أي حساب بقاعدة البيانات. سجّل حسابك أنت أولاً (الأول يصير المالك)، وبعدها شغّل الفحص.");
  }

  TOKEN = await getToken();
  const nameA = `iso_a_${tag}`, nameB = `iso_b_${tag}`;
  const A: User = { name: nameA, cookie: await register(nameA), id: "" };
  const B: User = { name: nameB, cookie: await register(nameB), id: "" };
  A.id = (db.prepare("SELECT id FROM users WHERE username = ?").get(nameA) as { id: string }).id;
  B.id = (db.prepare("SELECT id FROM users WHERE username = ?").get(nameB) as { id: string }).id;

  const mTask = `ISOTASK${tag}`, mGoal = `ISOGOAL${tag}`, mHabit = `ISOHABIT${tag}`, mRem = `ISOREM${tag}`;
  try {
    console.log("١) حساب A يضيف بياناته");
    const created: Record<string, boolean> = {};
    created.task = (await run(A, `add ${mTask}`)).json?.ok === true;
    created.goal = (await run(A, `goal ${mGoal}`)).json?.ok === true;
    created.habit = (await run(A, `habit add ${mHabit}`)).json?.ok === true;
    created.rem = (await run(A, `remind in 30m ${mRem}`)).json?.ok === true;
    for (const [k, v] of Object.entries(created)) v ? pass(`A أضاف ${k}`) : warn(`ما كدرت أضيف ${k} لـ A (يمكن صياغة الأمر مختلفة). فحصه يتخطى.`);

    console.log("\n٢) حساب A يشوف بياناته");
    const la = out(await run(A, "list"));
    if (created.task) check(la.includes(mTask), "A يشوف مهمته", "A ما يشوف مهمته (غريب)");

    console.log("\n٣) حساب B ما يشوف شي من بيانات A");
    const lb = out(await run(B, "list"));
    check(!lb.includes(mTask), "قائمة المهام عند B ما فيها مهمة A", "تسريب: B يشوف مهمة A بقائمة المهام!");
    check(!out(await run(B, "goals")).includes(mGoal), "أهداف B ما فيها هدف A", "تسريب: B يشوف هدف A!");
    check(!out(await run(B, "habits")).includes(mHabit), "عادات B ما فيها عادة A", "تسريب: B يشوف عادة A!");
    check(!out(await run(B, "reminders")).includes(mRem), "تذكيرات B ما فيها تذكير A", "تسريب: B يشوف تذكير A!");
    const sb = await api(B, "GET", "/api/state");
    check(sb.code === 200 && !leaks(sb.json), "حالة الصفحة عند B (/api/state) ما فيها شي من A", "تسريب: /api/state عند B فيه بيانات A!");
    const eb = await api(B, "GET", "/api/export");
    check(!leaks(eb.json), "تصدير B ما فيه شي من A", "تسريب: تصدير B فيه بيانات A!");

    console.log("\n٤) B ما يكدر يغيّر بيانات A");
    const sa = await api(A, "GET", "/api/state");
    const taskA = (sa.json?.tasks || []).find((t: any) => String(t.title).includes(mTask));
    if (taskA) {
      await run(B, `done ${taskA.id}`); // the same id number, in B's own list: must not touch A
      const after = await api(A, "GET", "/api/state");
      const still = (after.json?.tasks || []).find((t: any) => t.id === taskA.id);
      check(!!still && still.done === false, "أمر B ما غيّر مهمة A", "خطر: B غيّر مهمة A!");
    } else {
      warn("ما لقيت مهمة A بالحالة، فحص التعديل تخطّاه.");
    }
    const d = await run(A, `delete task ${taskA ? taskA.id : 1}`);
    if (d.json?.confirmId) {
      const steal = await api(B, "POST", "/api/command", { confirm: d.json.confirmId });
      check(steal.code === 400, "B ما كدر يوافق على سؤال تأكيد خاص بـ A", "خطر: B كدر يجاوب على تأكيد A!");
    } else {
      warn("أمر الحذف ما رجّع سؤال تأكيد، فحص سرقة التأكيد تخطّاه.");
    }

    console.log("\n٥) أوامر المالك فقط");
    check((await run(B, "backup")).code === 403, "B ممنوع من backup", "خطر: B يكدر يسوي backup!");
    check((await run(B, "restore")).code === 403, "B ممنوع من restore", "خطر: B يكدر يسوي restore!");

    console.log("\n٦) بدون تسجيل دخول");
    const anon = await fetch(`${BASE}/api/state`);
    check(anon.status === 401, "/api/state بدون دخول يرجع 401", `/api/state بدون دخول رجّع ${anon.status}`);

    console.log("\n٧) الملفات على القرص");
    const dirA = path.join(DATA_DIR, "users", A.id), dirB = path.join(DATA_DIR, "users", B.id);
    const textA = filesText(dirA), textB = filesText(dirB);
    check(fs.existsSync(dirA), "A عنده مجلد خاص", "ما انعمل مجلد لـ A (أو الحساب هو المالك!)");
    check(!leaks(textB), "ملفات B ما فيها شي من A", "تسريب: ملفات B فيها بيانات A!");
    let ownerFiles = "";
    for (const f of fs.readdirSync(".")) if (/\.(json|jsonl)$/.test(f) && fs.statSync(f).isFile()) ownerFiles += fs.readFileSync(f, "utf8");
    check(!leaks(ownerFiles), "ملفات المالك (بمجلد المشروع) ما فيها شي من A", "تسريب: بيانات A انكتبت بملفات المالك! (يعني موديول لسه مشترك)");
    if (created.task && !textA.includes(mTask)) warn("ما لقيت مهمة A بملفات مجلده (غريب).");
  } finally {
    console.log("\nتنظيف حسابات الفحص...");
    for (const u of [A, B]) {
      db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
      fs.rmSync(path.join(DATA_DIR, "users", u.id), { recursive: true, force: true });
    }
    db.close();
  }
  console.log(fails === 0 ? `\n✅ كل الفحوصات نجحت${warns ? ` (مع ${warns} تحذير)` : ""}` : `\n❌ فشل ${fails} فحص. لا ترسل رابط الدعوة لأحد قبل ما تنصلح.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nخطأ:", e instanceof Error ? e.message : e);
  process.exit(2);
});
