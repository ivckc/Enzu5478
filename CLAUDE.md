# CLAUDE.md — ANZU Project Reference

> Read this file at the start of every session before making any changes.

---

## Project Summary (English)

ANZU is a personal CLI assistant built with TypeScript, running on Node.js via `tsx`. It manages tasks, goals, habits, reminders, activity logs, backups, autostart, a web snapshot, and now an LLM agent layer (`ask` command).

The architecture is module‑based with a built‑in job scheduler. Data lives in local JSON files (tasks.json, goals.json, habits.json, reminders.json, activity.jsonl, backups/).

Stage 1 – Cleanup & Basic Configuration
  + Moved old prototypes (`anzu.ts`, `anzu-step5.ts`, `anzu-step6.ts`, `chat.ts`) to `archive/`
  + Added `tsconfig.json` (ES2022, Node16, strict)
  + Added `.env.example` documenting environment variables
  + Updated `CLAUDE.md` (this file)

Stage 2 – The `ask` command is now wired to the real `runAgentLoop`. It:
  + Loads `.env` automatically at startup (fails silently if missing)
  + Shows a clear Arabic error message if required LLM environment variables are not set
  + For write‑risk tools, asks user confirmation via the main readline loop (`yes` / `no`)
  + Sensitive tools (delete) always ask, even with `AUTO_CONFIRM_WRITES=true`

Stage 3 – Completed tool adapters (all match the pattern of the existing ones)
  + **tasks:** `tasks.list`, `tasks.add`, `tasks.done`, `tasks.reopen`, `tasks.rename`, `tasks.priority`, `tasks.due`, `tasks.link`, `tasks.delete`
  + **goals:** `goals.list`, `goals.add`, `goals.rename`, `goals.delete`
  + **habits:** `habits.list`, `habits.add`, `habits.check`, `habits.uncheck`, `habits.rename`, `habits.delete`
  + **reminders:** `reminders.list`, `reminders.add`, `reminders.cancel`

All new tools use Zod for parameter validation, confirm the write/modification before persisting (with the confirmation flow integrated into the main app), and are exported via each adapter’s `Tools = [...]` list for registration in `loop.ts`.

The project compiles cleanly (`npx tsc --noEmit` passes) and includes a Windows launcher (`anzu-run.cmd`) that restarts on crash.

---

## How to Run

```bash
npx tsx src/index.ts
```

Or via the provided launcher:
```cmd
anzu-run.cmd
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values. Required for the `ask` command:

| Variable | Required? | Description |
|---|---|---|
| `ANZU_LLM_BASE_URL` | yes | OpenAI‑compatible API base URL (e.g., `https://api.openai.com/v1`) |
| `ANZU_LLM_MODEL` | yes | Model name (e.g., `gpt-4o-mini`) |
| `ANZU_LLM_API_KEY` | yes | API key (leave empty if the provider doesn’t require one) |
| `AUTO_CONFIRM_WRITES` | no | `true` = agent acts without asking. Default: `false` |
| `ANZU_MAX_ITERATIONS` | no | Max LLM→tool rounds per request. Default: `5` |

If LLM variables are missing, the agent returns a friendly Arabic error listing what’s still required (e.g., `⚠️  الذكاء الاصطناعي غير مفعّل.`).

---

## Usage Examples (Arabic)

1. "ضيف مهمة دعني عاجل" → adds a task (immediate, no confirmation)
2. "شنو مهامي؟"      → lists tasks (read‑only)
3. "غيّر أولوية مهمة 1 لعاجل" → changes priority (requires confirmation)
4. "احذف هدف 1"      → deletes a goal (always requires confirmation)
5. "سجّل عادة 1 اليوم"  → marks a habit for today
6. "أنشّر عند الغد 09:00 مواعيد" → creates a reminder

All examples work just after `npx tsx src/index.ts`. Refer to the full `CLAUDE.md` for deeper usage notes.

---

*Last updated: 2026-10-19 — Stage 3 completed. Full agent tool suite is now available.*
