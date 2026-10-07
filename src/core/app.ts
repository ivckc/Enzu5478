import * as readline from "node:readline";
import type { Command, Job, Module, Result } from "./types";
import { appendLog } from "./log";

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let pending: (() => Result) | null = null;
  let closed = false;

  // Shows a result, writes its log entries, passes its notices on, and remembers a question.
  function show(result: Result): void {
    for (const line of result.lines) {
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
    if (result.confirm !== undefined) {
      pending = result.confirm;
    }
  }

  // Shows something that was not asked for (like a reminder), without
  // breaking the line the user is typing.
  function showByItself(result: Result): void {
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

  // A job that is still working (for example, waiting for the network) is not started again.
  const busy = new Set<Job>();

  function startJob(job: Job, atStart: boolean): void {
    if (busy.has(job)) {
      return;
    }
    let out: Result | null | Promise<Result | null>;
    try {
      out = job.run();
    } catch {
      out = jobProblem(job);
    }
    if (out instanceof Promise) {
      busy.add(job);
      out
        .catch(() => jobProblem(job))
        .then((result) => {
          busy.delete(job);
          if (result !== null) {
            showByItself(result);
          }
        });
    } else if (out !== null) {
      if (atStart) {
        show(out);
      } else {
        showByItself(out);
      }
    }
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
    show(command.run(text.slice(command.name.length).trim()));
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
