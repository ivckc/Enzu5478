import type { Job, Module } from "../core/types";

const CHECK_EVERY_MS = 5_000;
const GAP_MS = 30_000; // if more time than this passed between two checks, we were paused

let lastCheck = Date.now();

function describe(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// If the computer sleeps, this program sleeps too. When it wakes up we say so,
// so a late reminder does not look like a mistake.
const gapJob: Job = {
  name: "system",
  everyMs: CHECK_EVERY_MS,
  run: () => {
    const now = Date.now();
    const gap = now - lastCheck;
    lastCheck = now;
    if (gap < GAP_MS) {
      return null;
    }
    const text = describe(gap);
    return {
      ok: true,
      lines: [`[anzu] I was paused for about ${text}. The computer may have been asleep.`],
      logs: [{ action: "system.gap", detail: `paused for about ${text}`, ok: true, actor: "anzu" }],
    };
  },
};

export const systemModule: Module = {
  name: "system",
  commands: [],
  jobs: [gapJob],
};
