// Confirmation System - uses a callback so the main readline loop handles the prompt.
// The agent loop passes a confirmFn; if none is provided it auto-approves (for tests).

export type ConfirmFn = (question: string) => Promise<boolean>;

export type ConfirmationRequest = {
  toolName: string;
  summary: string;
  detail?: string;
};

export type ConfirmationResult = {
  approved: boolean;
};

/**
 * Ask the user for confirmation via the provided callback.
 * The callback receives a human-readable question and returns true/false.
 */
export async function requestConfirmation(
  req: ConfirmationRequest,
  confirmFn: ConfirmFn,
): Promise<ConfirmationResult> {
  const question =
    `[تأكيد] ${req.toolName}: ${req.summary}` +
    (req.detail ? `\n  ${req.detail}` : '') +
    '\nاكتب yes أو نعم للموافقة:';

  const approved = await confirmFn(question);
  return { approved };
}

/**
 * A ConfirmFn implementation that works inside the main readline loop.
 * Call makeLineFn(resolve) to produce a one-shot listener; the loop
 * removes it after the first answer.
 */
export function makeConfirmFn(
  onQuestion: (question: string, resolve: (answer: boolean) => void) => void,
): ConfirmFn {
  return (question) =>
    new Promise<boolean>((resolve) => {
      onQuestion(question, (answer) => resolve(answer));
    });
}
