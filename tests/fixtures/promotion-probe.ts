import type { MemoryKind } from "../../src/core/types.ts";

// Promotion's acceptance probe (final review I1, layer 2): memories as the distiller or the
// history import files them, decisions and conventions of importance 4 or more. The episodic
// ones record something that happened in a session, phrased as a convention or a decision,
// one or more per pattern family; none of them may be proposed. The standing ones are rules
// that stay true for the project, some naming a file or a version, which must survive: all
// but one at most. All synthetic.

export interface ProbeMemory {
  title: string;
  body: string;
  kind: MemoryKind;
  /** The prompt of the turn the memory was distilled from, when it matters. */
  prompt?: string;
  /** The pattern family that should catch it (episodic ones only). */
  family?: string;
}

export const EPISODIC: ProbeMemory[] = [
  {
    family: "commit",
    kind: "decision",
    title: "Keep the cart refactor from 3f9c2ab as the base",
    body: "The cart refactor landed in 3f9c2ab; later work builds on it.",
  },
  {
    family: "commit",
    kind: "convention",
    title: "Rebase onto main before merging the search work",
    body: "Rebased onto 9b1e04d7c2 so the search branch has the new index.",
  },
  {
    family: "pull-request",
    kind: "decision",
    title: "Ship the billing fix through PR #482",
    body: "The billing fix goes out with the next release.",
  },
  {
    family: "pull-request",
    kind: "convention",
    title: "Hold the pricing change until review",
    body: "Waiting on https://example.test/acme/shop/pull/1291 before touching prices.",
  },
  {
    family: "pull-request",
    kind: "decision",
    title: "Close the flaky checkout test ticket",
    body: "Tracked in issue 77; marked as fixed after the retry change.",
  },
  {
    family: "agent-id",
    kind: "convention",
    title: "Agent a7f3c9e1 owns the migration task",
    body: "The migration task was handed to agent a7f3c9e1 with the opus model.",
  },
  {
    family: "agent-id",
    kind: "decision",
    title: "Use the result from toolu_01HxQ9 for the schema",
    body: "The schema came back from the tool call and was kept.",
  },
  {
    family: "uuid",
    kind: "convention",
    title: "Resume the import from its last checkpoint",
    body: "Resume from run 0b8f6d2e-91c4-4a7e-b3f2-5c1d9e8a7b60 when it stops.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Dispatched three subagents for the auth rewrite",
    body: "One per module, each with its own worktree.",
  },
  {
    family: "process",
    kind: "convention",
    title: "Re-dispatch the implementer after a failed review",
    body: "The implementer gets the review notes and tries again.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Review verdict: REJECTED with 3 blockers",
    body: "The quality gate rejected the change; the blockers are listed in the report.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Fix round 2/5 addresses the reviewer's findings",
    body: "Both findings were addressed and the tests pass.",
  },
  {
    family: "process",
    kind: "convention",
    title: "Task 4 goes after the schema change",
    body: "The order of the plan's tasks was swapped.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Opened a PR from dev to main",
    body: "Everything on dev goes to main together.",
  },
  {
    family: "process",
    kind: "convention",
    title: "Session plan: finish the exports, then the emails",
    body: "Exports first; emails if there is time.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Finish the onboarding emails today",
    body: "The copy is ready; only the template is left.",
  },
  {
    family: "process",
    kind: "convention",
    title: "Pick up the invoice export in the next session",
    body: "Left half done; the CSV writer still needs the totals.",
  },
  {
    family: "process",
    kind: "decision",
    title: "Wave 3 covers the admin screens",
    body: "The admin screens are the third wave of the redesign.",
  },
  {
    family: "process",
    kind: "convention",
    title: "Multi-session work coordination for the checkout and search windows",
    body: "Each window keeps to its own folders until the wave closes.",
  },
  {
    family: "process",
    kind: "decision",
    title: "End-to-end validation successful in two real sessions",
    body: "Both agents saw the notes at the right moments.",
  },
  {
    family: "prompt-copy",
    kind: "convention",
    title: "Continue with the next step of the plan",
    body: "The user asked to go on with the plan.",
    prompt: "continue with the next step of the plan please",
  },
  {
    family: "prompt-copy",
    kind: "decision",
    title: "Vamos avançar com a migração dos pagamentos",
    body: "O utilizador pediu para avançar.",
    prompt: "vamos avançar com a migração dos pagamentos agora",
  },
  {
    family: "prompt-copy",
    kind: "convention",
    title: "Check the deploy logs and tell me what failed",
    body: "The deploy logs were checked.",
    prompt: "Check the deploy logs and tell me what failed\nthe staging one",
  },
];

export const STANDING: ProbeMemory[] = [
  {
    kind: "convention",
    title: "Orders are never deleted, only cancelled",
    body: "A cancelled order keeps its lines and payments for the accounts.",
  },
  {
    kind: "decision",
    title: "Money is stored in integer cents",
    body: "Floats lose cents; every amount is an integer number of cents with its currency.",
  },
  {
    kind: "convention",
    title: "Config is read from src/config/settings.ts only",
    body: "No module reads the environment directly; src/config/settings.ts is the one place.",
  },
  {
    kind: "decision",
    title: "Stay on Node 22 until the queue library supports 24",
    body: "Version 4.2.1 of the queue library breaks on Node 24's streams.",
  },
  {
    kind: "convention",
    title: "Every API error carries a stable code",
    body: "Clients match on the code, like ORDER_NOT_FOUND; the message may change.",
  },
  {
    kind: "decision",
    title: "Background jobs must be idempotent",
    body: "A job may run twice after a worker restart; it must leave the same result.",
  },
  {
    kind: "convention",
    title: "Dates are stored in UTC and shown in the customer's zone",
    body: "Store UTC; convert only when rendering.",
  },
  {
    kind: "decision",
    title: "Session cookies are httpOnly and SameSite=Lax",
    body: "Scripts never read the session cookie; cross-site posts do not carry it.",
  },
  {
    kind: "convention",
    title: "Migrations ship before the code that needs them",
    body: "Deploy the migration in its own release; the code follows in the next.",
  },
  {
    kind: "decision",
    title: "We use PostgreSQL 16, not MongoDB",
    body: "All services keep their data in PostgreSQL; see docs/adr/0003-database.md.",
  },
  {
    kind: "convention",
    title: "Tests must pass before a merge",
    body: "The merge button stays off until the checks are green.",
  },
  {
    kind: "decision",
    title: "Every release is validated on staging first",
    body: "Staging runs the release for a day before production gets it.",
  },
];
