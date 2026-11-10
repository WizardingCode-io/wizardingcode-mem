// The edge: what every text passes through on its way off this machine.
import { type Redacted, redact } from "../core/redact.ts";
import type { Env } from "../settings/settings.ts";

/**
 * A text as it may leave: whatever `redact` recognises (a private block, a credential with
 * a known shape, the value of a sensitive variable of `env`, the store's environment) is
 * replaced by its marker. A sync passes every outgoing text through here, in the process
 * that sends it. It is the only protection at the level of the text: what `redact` does
 * not recognise leaves as written.
 */
export function redactForSend(text: string, env: Env): Redacted {
  return redact(text, { env });
}
