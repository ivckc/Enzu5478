let source: () => Record<string, unknown> = () => ({});

export function setSnapshotSource(fn: () => Record<string, unknown>): void {
  source = fn;
}

export function getSnapshots(): Record<string, unknown> {
  return source();
}

// What running a command from the web page gives back.
export type Outcome = { ok: boolean; lines: string[]; confirm?: () => Outcome };

let runner: (text: string) => Outcome = () => ({ ok: false, lines: ["Anzu is not ready."] });

export function setRunner(fn: (text: string) => Outcome): void {
  runner = fn;
}

export function runCommand(text: string): Outcome {
  return runner(text);
}
