import type { Result } from "./types";

// A normal reply.
export function say(...lines: string[]): Result {
  return { ok: true, lines };
}

// A reply that says something was wrong (bad input, not found, ...).
export function problem(...lines: string[]): Result {
  return { ok: false, lines };
}
