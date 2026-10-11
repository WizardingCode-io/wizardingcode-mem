/**
 * What the host sends in the user's place: a background task finishing, a subagent
 * reporting back. Nobody asked anything, so it is neither a query nor a rule.
 */
const FROM_THE_HOST = /^\s*<(?:task-notification|agent-message)[\s>]/;

export function isFromTheHost(prompt: string): boolean {
  return FROM_THE_HOST.test(prompt);
}
