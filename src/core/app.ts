import * as readline from "node:readline";
import type { Command, Job, Module, Result } from "./types";
import { appendLog } from "./log";
import { setRunner, setSnapshotSource } from "./snapshot";
import type { Outcome } from "./snapshot";
import { LOCAL, allUsers, runAs } from "./userctx";

export function startApp(modules: Module[], greeting: () => string): void {
  // 1. Let each module load its own data. Stop if something is damaged.
  for (const mod of modules) {
    if (mod.init !== undefined) {
      const problems = mod.init();
      if (problems.length > 0) {
        for (const line of problems) {
          console.log(line);
        }
        process.exit(3);
      }
    }
  }

  const commands: Command[] = [];
  const jobs: Job[] = [];
  for (const mod of modules) {
    for (const command of mod.commands) {
      commands.push(command);
    }
    for (const job of mod.jobs ?? []) {
      jobs.push(job);
    }
  }

  setSnapshotSource(() => {
    const out: Record<string, unknown> = {};
    for (const mod of modules) {
      if (mod.snapshot !== undefined) {
        out[mod.name] = mod.snapshot();
      }
    }
    return out;
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let pending: (() => Result) | null = null;
  let closed = false;

  // Shows a result, writes its log entries, passes its notices on, and remembers a question.
  function show(result: Result, print = true, ask = true): void {
    for (const line of print ? result.lines : []) {
      console.log(line);
    }
    for (const info of result.logs ?? []) {
      const saved = appendLog({
        time: new Date().toISOString(),
        actor: info.actor ?? "user",
        action: info.action,
        detail: info.detail,
        ok: info.ok,
      });
      if (!saved) {
        console.log("Note: I could not write to the activity log.");
        break;
      }
    }
    for (const notice of result.notices ?? []) {
      for (const mod of modules) {
        if (mod.onNotice !== undefined) {
          const extra = mod.onNotice(notice);
          if (extra !== null) {
            show(extra);
          }
        }
      }
    }
    if (result.confirm !== undefined && ask) {
      pending = result.confirm;
    }

    // Support async commands that return a Promise (e.g., the agent loop).
    if ("_async" in result && result._async instanceof Promise) {
      result._async
        .then((asyncResult: Result) => {
          if (asyncResult.confirm !== undefined) {
            pending = asyncResult.confirm;
          } else {
            show(asyncResult);
          }
        })
        .catch(() => {});
    }
  }

  // Used by the web page: same effects (log, notices), but nothing is printed here
  // and the question is handed back to the page, not to this window.
  function toOutcome(result: Result): Outcome {
    show(result, false, false);
    const next = result.confirm;
    return {
      ok: result.ok,
      lines: result.lines,
      confirm: next === undefined ? undefined : () => toOutcome(next()),
    };
  }

  setRunner((text) => {
    const command = findCommand(text);
    if (command === null) {
      return { ok: false, lines: ["I did not understand that command."] };
    }
    const result = command.run(text.slice(command.name.length).trim());
    // The web runner is synchronous; async commands (ask) are not supported
    // from the web page — return a placeholder.
    if (result instanceof Promise) {
      return { ok: false, lines: ["This command is not available from the web interface."] };
    }
    return toOutcome(result);
  });

  // Shows something that was not asked for (like a reminder), without
  // breaking the line the user is typing.
  // print = false: other users' messages are not printed in this window (only logged / sent to their phone).
  function showByItself(result: Result, print = true): void {
    if (!print) {
      show(result, false);
      return;
    }
    if (closed || result.lines.length === 0) {
      show(result);
      return;
    }
    const tty = process.stdout.isTTY === true;
    if (tty) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    }
    show(result);
    rl.prompt(true);
  }

  function jobProblem(job: Job): Result {
    return {
      ok: false,
      lines: [`Note: the background job "${job.name}" had a problem.`],
      logs: [{ action: "job.error", detail: job.name, ok: false, actor: "anzu" }],
    };
  }

  // A job that is still working (for example, waiting for the network) is not started again
  // (one entry per job AND user).
  const busy = new Set<string>();

  // Every job runs once for every user, "as" that user, so reminders, phone messages and the
  // morning brief use each person's own data.
  function startJob(job: Job, atStart: boolean): void {
    for (const userId of allUsers()) {
      runJob(job, userId, atStart);
    }
  }

  function runJob(job: Job, userId: string, atStart: boolean): void {
    const key = `${job.name}:${userId}`;
    if (busy.has(key)) {
      return;
    }
    const print = userId === LOCAL; // only the owner sees job messages in this window
    runAs(userId, () => {
      let out: Result | null | Promise<Result | null>;
      try {
        out = job.run();
      } catch {
        out = jobProblem(job);
      }
      if (out instanceof Promise) {
        busy.add(key);
        out
          .catch(() => jobProblem(job))
          .then((result) => {
            busy.delete(key);
            if (result !== null) {
              showByItself(result, print);
            }
          });
      } else if (out !== null) {
        if (atStart && print) {
          show(out);
        } else {
          showByItself(out, print);
        }
      }
    });
  }

  function showHelp(): void {
    console.log("Commands:");
    for (const command of commands) {
      console.log(`  ${command.usage.padEnd(26)}${command.about}`);
    }
    console.log(`  ${"exit".padEnd(26)}close the program`);
  }

  // The longest matching name wins: "rename task" beats "rename".
  function findCommand(text: string): Command | null {
    let best: Command | null = null;
    for (const command of commands) {
      const matches = text === command.name || text.startsWith(command.name + " ");
      if (matches && (best === null || command.name.length > best.name.length)) {
        best = command;
      }
    }
    return best;
  }

  function handle(text: string): void {
    if (text === "") {
      return;
    }
    const space = text.indexOf(" ");
    const word = space === -1 ? text : text.slice(0, space);
    if (word === "help") {
      showHelp();
      return;
    }
    const command = findCommand(text);
    if (command === null) {
      console.log(`I did not understand "${word}". Type help.`);
      return;
    }
    const outcome = command.run(text.slice(command.name.length).trim());
    if (outcome instanceof Promise) {
      // Async command (e.g. "ask"): show a spinner line immediately,
      // then print the real result when the promise resolves.
      console.log("...");
      outcome
        .then((result: Result | Promise<Result>) => {
          if (result instanceof Promise) {
            result.then((final) => showByItself(final));
          } else {
            showByItself(result);
          }
        })
        .catch((err: unknown) =>
          showByItself({
            ok: false,
            lines: [`Error: ${err instanceof Error ? err.message : String(err)}`],
          })
        );
    } else {
      show(outcome);
    }
  }

  rl.setPrompt("anzu> ");
  console.log(greeting());

  // Run every job once now (this shows reminders that came due while we were closed).
  for (const job of jobs) {
    startJob(job, true);
  }
  rl.prompt();

  // Then run them again and again.
  const timers: ReturnType<typeof setInterval>[] = [];
  for (const job of jobs) {
    timers.push(setInterval(() => startJob(job, false), job.everyMs));
  }
  // When the program closes, stop the timers so it can end.
  rl.on("close", () => {
    closed = true;
    for (const timer of timers) {
      clearInterval(timer);
    }
  });

  rl.on("line", (line: string) => {
    const text = line.trim();
    if (text === "exit") {
      console.log("Bye.");
      rl.close();
      return;
    }
    if (pending !== null) {
      const action = pending;
      pending = null;
      if (text === "yes") {
        show(action());
      } else {
        console.log("Cancelled. Nothing was changed.");
      }
      rl.prompt();
      return;
    }
    handle(text);
    rl.prompt();
  });
}
