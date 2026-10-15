// Confirmation System - Handles user confirmations for sensitive/write actions

import * as readline from 'node:readline';

export type ConfirmationRequest = {
  toolName: string;
  summary: string;
  detail?: string;
};

export type ConfirmationResult = {
  approved: boolean;
  userInput: string;
};

// Readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function closeReadline(): void {
  // Don't close, let the main app manage it
}

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Ask user for confirmation on a tool execution
 * Returns true if approved, false if cancelled
 */
export async function requestConfirmation(req: ConfirmationRequest): Promise<ConfirmationResult> {
  const lines = [
    '',
    `[CONFIRMATION] ${req.toolName}`,
    `Summary: ${req.summary}`,
  ];

  if (req.detail) {
    lines.push(`Detail: ${req.detail}`);
  }

  lines.push('Type "yes" to confirm, anything else to cancel.');
  lines.push('anzu> ');

  console.log(lines.join('\n'));

  const answer = await question('');
  const approved = answer === 'yes' || answer === 'y' || answer === 'نعم';

  return {
    approved,
    userInput: answer,
  };
}

/**
 * Check if a tool execution requires confirmation based on risk level
 */
export function requiresConfirmation(riskLevel: 'read' | 'write' | 'sensitive'): boolean {
  return riskLevel !== 'read';
}
