// Agent Module - Exports the agent for the main app

import type { Module, Result } from '../core/types';

export const agentModule: Module = {
  name: 'agent',
  commands: [
    {
      name: 'ask',
      usage: 'ask <message>',
      about: 'ask Anzu a question (natural language)',
      run: (rest): Result => {
        if (rest === '') {
          return {
            ok: false,
            lines: ['Usage: ask <your question or command>'],
          };
        }
        // For now, just echo the message
        // Full agent integration will be implemented later
        return {
          ok: true,
          lines: [
            `Agent loop would process: ${rest}`,
            '(Agent loop not yet fully integrated)',
          ],
        };
      },
    },
  ],
};
