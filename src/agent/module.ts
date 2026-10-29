// Agent Module - wires the "ask" command to the real agent loop

import type { Module, Result } from '../core/types';
import { runAgentLoop } from './loop';

export const agentModule: Module = {
  name: 'agent',
  commands: [
    {
      name: 'ask',
      usage: 'ask <message>',
      about: 'ask Anzu in natural language (needs LLM config in .env)',

      // run() returns a Promise<Result> — app.ts handles that now.
      run: async (rest): Promise<Result> => {
        if (rest.trim() === '') {
          return {
            ok: false,
            lines: ['Usage: ask <your question or command>'],
          };
        }

        // confirmFn is called by the agent loop whenever it needs the user
        // to approve a write/sensitive action.  Because we are now inside an
        // async function that app.ts awaits, we can simply print the question
        // and wait for the next stdin line using a one-shot readline listener.
        // We re-use the same stdin/stdout that the rest of the app uses —
        // we do NOT create a second readline interface.
        const confirmFn = (question: string): Promise<boolean> =>
          new Promise<boolean>((resolve) => {
            process.stdout.write(`\n${question}\nanzu(confirm)> `);

            const onLine = (chunk: Buffer | string) => {
              const answer = chunk.toString().trim().toLowerCase();
              process.stdin.removeListener('data', onLine);
              process.stdin.resume();
              resolve(answer === 'yes' || answer === 'y' || answer === 'نعم');
            };

            // Pause readline so raw data events work, answer, then resume.
            process.stdin.once('data', onLine);
          });

        try {
          const answer = await runAgentLoop(rest.trim(), confirmFn);
          return {
            ok: true,
            lines: answer.split('\n'),
          };
        } catch (err: unknown) {
          return {
            ok: false,
            lines: [
              `خطأ غير متوقع في الـ agent:`,
              err instanceof Error ? err.message : String(err),
            ],
          };
        }
      },
    },
  ],
};
