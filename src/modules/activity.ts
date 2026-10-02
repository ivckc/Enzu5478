import type { Module } from "../core/types";
import { LOG_FILE, readLog } from "../core/log";
import { toId } from "../core/parse";
import { problem, say } from "../core/result";

function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export const activityModule: Module = {
  name: "activity",
  commands: [
    {
      name: "log",
      usage: "log [n]",
      about: "show the last actions (default 10)",
      run: (rest) => {
        let count = 10;
        if (rest !== "") {
          const n = toId(rest);
          if (n === null || n < 1 || n > 50) {
            return problem("Use: log  or  log <how many, from 1 to 50>");
          }
          count = n;
        }
        const data = readLog();
        if (data === null) {
          return problem(`I could not read ${LOG_FILE}.`);
        }
        const lines: string[] = [];
        if (data.entries.length === 0) {
          lines.push("No activity yet.");
        } else {
          const last = data.entries.slice(-count);
          lines.push(`Last ${last.length} action(s):`);
          for (const e of last) {
            const status = e.ok ? "OK" : "FAILED";
            lines.push(
              `${localTime(e.time)}  ${e.actor.padEnd(5)}  ${e.action.padEnd(15)}  ${e.detail}  ${status}`
            );
          }
        }
        if (data.unreadable > 0) {
          lines.push(`(${data.unreadable} line(s) in ${LOG_FILE} could not be read.)`);
        }
        return say(...lines);
      },
    },
  ],
};
