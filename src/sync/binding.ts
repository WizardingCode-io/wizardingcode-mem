// The two-phase bind of a project to a server under a shared name (ADR 0028): the dry run of
// the level and the one lookup first, so every refusal that needs no server is given before any
// request; then the server (a create when asked); then the write with the name's id. The CLI
// asks its question between the two; the viewer's PUT runs both. These are server calls, so
// they live in the sync client and never under `src/sharing/`, which the sync imports; they
// name no sharing table, reaching them through `setLevel` and `servers.ts`.
import { isSharedName, NAME_PREFIX } from "../core/identity.ts";
import { levelKey } from "../sharing/levels.ts";
import { loadPolicy } from "../sharing/policy.ts";
import { withChange, wouldLeave } from "../sharing/report.ts";
import {
  type SetLevelOutcome,
  type SetLevelRefusal,
  setLevel,
  setLevelMessage,
} from "../sharing/store.ts";
import type { Level } from "../sharing/types.ts";
import { CONTRACT, type NameItemShape } from "../team/contract.ts";
import { plural } from "../util/text.ts";
import { type ClientFailed, SyncClient } from "./client.ts";
import type { SyncContext } from "./context.ts";
import { rejoinName } from "./inbound.ts";
import { failureMessage } from "./join.ts";
import {
  CONTRACT_READ_MS,
  readTokens,
  type ServerRow,
  serverById,
  setContract,
  spokenAfterMe,
} from "./servers.ts";
import { clearName, type NameState, nameStateOf } from "./state.ts";

export interface BindInput {
  projectId: number;
  destination: string;
  level: Level;
  /** A shared name alias (`name:<slug>`, through `sharedNameOf`) to create or join. */
  as?: string | null;
  /** The remote alias of the folder the person is in, as `setLevel` takes it. */
  remoteAlias?: string | null;
  source: "cli" | "viewer";
}

export type BindReason =
  | SetLevelRefusal
  | "contract"
  | "exists"
  | "purged"
  | "unknown-name"
  | "unreachable"
  | "server";

export interface BindRefusal {
  ok: false;
  reason: BindReason;
  /** `one-server`: the server the project is bound to. */
  server?: string;
  /** `name-taken`: the other project's name. */
  other?: string;
  /** `exists`: the live name's item. */
  name?: NameItemShape | null;
  /** The name was created on the server before the write refused (`BIND_MESSAGES["created-unbound"]`). */
  named?: boolean;
  message?: string;
}

/** What would leave for the project at the level asked: the question's counts. */
export interface BindCounts {
  entries: number;
  memories: number;
  /** The project's imported memories, which stay whatever the level. */
  imported: number;
}

export interface Prepared {
  ok: true;
  /**
   * `create`: the server holds no live name of that alias; `join`: it does; `none`: no server
   * step (a binding by a remote, a level change on a name already bound, or no server yet).
   */
  action: "create" | "join" | "none";
  /** The shared name the level would bind to; null when it binds by a remote. */
  alias: string | null;
  slug: string | null;
  /** The live name's item, on a join. */
  name: NameItemShape | null;
  dryRun: Extract<SetLevelOutcome, { ok: true }>;
  counts: BindCounts;
  /** The id the project's level row holds for this alias from an earlier binding; sent on a re-create. */
  storedId: string | null;
  /** The name's flag, when it carries one. */
  state: NameState | null;
  server: ServerRow | null;
  input: BindInput;
}

export type BindOutcome =
  | (Extract<SetLevelOutcome, { ok: true }> & {
      created: boolean;
      joined: boolean;
      name: NameItemShape | null;
    })
  | BindRefusal;

/** The one seam a test supplies, to run the race between the server and the write. */
export interface BindHooks {
  afterServer?: () => void;
}

export const BIND_MESSAGES = {
  "created-unbound": (slug: string): string =>
    `the name \`${slug}\` was created on the server; set the level again to use it, or the operator purges it`,
  contract: "the server speaks contract 1; shared names need its upgrade",
  unreachable: "the server could not be reached; nothing changed",
} as const;

/** A name's counts as a person reads them: `2 entries, 1 memory`. */
export const nameCounts = (name: { entries: number; memories: number }): string =>
  `${plural(name.entries, "entry", "entries")}, ${plural(name.memories, "memory", "memories")}`;

/** What a bind refusal's sentence names: the slug asked for, the server, the name the project carries. */
export interface BindContext {
  slug: string | null;
  server: string;
  current: string | null;
}

/** A bind refusal as the person reads it: the sentence names the slug, the server and the other side. */
export function bindMessage(refusal: BindRefusal, context: BindContext): string {
  const slug = context.slug ?? "";
  switch (refusal.reason) {
    case "unknown-name":
      return `no shared name \`${slug}\` on ${context.server}; --create makes it, or pick one from share names`;
    case "exists":
      return `\`${slug}\` exists on ${context.server}, created by ${refusal.name?.createdBy.name ?? "a teammate"} (${nameCounts(refusal.name ?? { entries: 0, memories: 0 })}); run without --create to join it`;
    case "purged":
      return `the operator removed \`${slug}\` from ${context.server}; pick another name`;
    case "contract":
    case "unreachable":
    case "server":
      return refusal.message ?? refusal.reason;
    case "one-server":
      return refusal.server === undefined
        ? setLevelMessage("one-server")
        : `this project is bound to ${refusal.server}; set it to Nothing there first`;
    case "name-taken":
      return setLevelMessage("name-taken", {
        name: slug,
        ...(refusal.other === undefined ? {} : { other: refusal.other }),
      });
    case "renamed":
      return setLevelMessage("renamed", context.current === null ? {} : { name: context.current });
    default:
      return setLevelMessage(refusal.reason);
  }
}

const refusalOf = (outcome: Extract<SetLevelOutcome, { ok: false }>): BindRefusal => ({
  ok: false,
  reason: outcome.reason,
  ...(outcome.server === undefined ? {} : { server: outcome.server }),
  ...(outcome.other === undefined ? {} : { other: outcome.other }),
});

const failed = (failure: ClientFailed): BindRefusal => {
  const { kind } = failure;
  if (kind === "network" || kind === "deadline" || kind === "redirect" || kind === "aborted")
    return { ok: false, reason: "unreachable", message: BIND_MESSAGES.unreachable };
  return { ok: false, reason: "server", message: failureMessage(failure) };
};

const contractRefusal = (): BindRefusal => ({
  ok: false,
  reason: "contract",
  message: BIND_MESSAGES.contract,
});

const NO_TOKEN: BindRefusal = {
  ok: false,
  reason: "server",
  message: "the server's token is missing; share server rejoin",
};

/** The client for a server row, speaking the row's contract; `NO_TOKEN` when the token file lacks it. */
function clientFor(ctx: SyncContext, server: ServerRow): SyncClient | BindRefusal {
  const token = readTokens(ctx.dataDir)[server.serverId];
  if (token === undefined) return NO_TOKEN;
  return new SyncClient(ctx, { url: server.url, token, contract: server.contract });
}

/**
 * The contract a row speaks, after one active read of `/v1/me` when the row is below the
 * binary's: the row may be behind the server (ADR 0028's live path up). The row and the
 * client are brought to what was read.
 */
export async function spokenContract(
  ctx: SyncContext,
  server: ServerRow,
  client: SyncClient,
): Promise<number> {
  if (server.contract >= CONTRACT) return server.contract;
  const spoken = spokenAfterMe(await client.me({ deadlineMs: CONTRACT_READ_MS }), server.contract);
  if (spoken !== server.contract) {
    setContract(ctx.db, server.serverId, spoken);
    client.speak(spoken);
  }
  return spoken;
}

/**
 * Every live name of a server, page by page, at most 1,000 (`namesAll`): the one read the
 * dock's field and `share names` make. A row at 1 reads `/v1/me` once first; still 1, or a
 * bare 404 on the route (the row then set to 1), `contract`; a failure `unreachable`.
 */
export async function listServerNames(
  ctx: SyncContext,
  server: ServerRow,
): Promise<{ ok: true; names: NameItemShape[]; truncated: boolean } | BindRefusal> {
  const client = clientFor(ctx, server);
  if (!(client instanceof SyncClient)) return client;
  if ((await spokenContract(ctx, server, client)) < 2) return contractRefusal();
  const listed = await client.namesAll();
  if (listed.ok) return listed;
  if (listed.kind === "oldServer") {
    setContract(ctx.db, server.serverId, 1);
    return contractRefusal();
  }
  return failed(listed);
}

/** What would leave for the project at the level, under the policy as it would read. */
function countsOf(ctx: SyncContext, input: BindInput, server: ServerRow | null): BindCounts {
  const policy = loadPolicy(ctx.db, ctx.dataDir, ctx.env, server?.serverId);
  const preview = withChange(
    policy,
    { level: { projectId: input.projectId, level: input.level, destination: input.destination } },
    ctx.dataDir,
  );
  const report = wouldLeave(ctx.db, ctx.dataDir, ctx.env, preview, {
    now: ctx.clock.now,
    projectId: input.projectId,
    destination: input.destination,
  });
  const own = report.perProject.find((project) => project.id === input.projectId);
  return {
    entries: report.counts.entries,
    memories: report.counts.memories,
    imported: own?.imported ?? 0,
  };
}

/**
 * The dry run of the level, the contract read and the one lookup: every refusal that needs no
 * server (`invalid`, `no-project`, `disabled`, `has-remote`, `renamed`, `name-taken`,
 * `no-name`, `one-server`) is answered before any request; a row below the binary's contract
 * reads `/v1/me` once and, still below 2, answers `contract`; then `GET /v1/names/<alias>`
 * says whether the name would be created or joined. A binding by a remote, a level change on
 * a name already bound and a store with no server need no server step (`none`).
 */
export async function prepareBinding(
  ctx: SyncContext,
  input: BindInput,
): Promise<Prepared | BindRefusal> {
  const as = input.as ?? null;
  const server = serverById(ctx.db, input.destination);
  const recreated =
    as !== null && server !== null && nameStateOf(ctx.db, server.serverId, as) === "recreated";
  const dry = setLevel(ctx.db, {
    projectId: input.projectId,
    destination: input.destination,
    level: input.level,
    source: input.source,
    now: ctx.clock.now,
    confirm: true,
    dryRun: true,
    as,
    remoteAlias: input.remoteAlias ?? null,
    recreated,
  });
  if (!dry.ok) return refusalOf(dry);
  const alias = isSharedName(dry.boundAlias) ? dry.boundAlias : null;
  const base = {
    ok: true as const,
    dryRun: dry,
    counts: countsOf(ctx, input, server),
    input,
    server,
    alias,
    slug: alias === null ? null : alias.slice(NAME_PREFIX.length),
  };
  if (alias === null || server === null)
    return { ...base, action: "none", name: null, storedId: null, state: null };

  const policy = loadPolicy(ctx.db, ctx.dataDir, ctx.env, server.serverId);
  const row = policy.levels.get(levelKey(input.projectId, input.destination));
  const boundNow =
    row !== undefined &&
    row.boundAlias === alias &&
    (row.reason === "allowed" || row.reason === "level-receive");
  const storedId = row !== undefined && row.boundAlias === alias ? row.nameId : null;
  const state = nameStateOf(ctx.db, server.serverId, alias);
  // A level change on a name the project is bound by needs nothing of the server, unless the
  // name was lost or re-created there: then the person creates or joins it again.
  if (boundNow && state !== "recreated" && state !== "missing")
    return { ...base, action: "none", name: null, storedId, state };

  const client = clientFor(ctx, server);
  if (!(client instanceof SyncClient)) return client;
  // The row may be behind the server: one active read before refusing.
  if ((await spokenContract(ctx, server, client)) < 2) return contractRefusal();
  const looked = await client.nameByAlias(alias);
  if (looked.ok) return { ...base, action: "join", name: looked.body, storedId, state };
  if (looked.kind === "refused" && looked.body.error === "unknown-name")
    return { ...base, action: "create", name: null, storedId, state };
  if (looked.kind === "oldServer") {
    setContract(ctx.db, server.serverId, 1);
    return contractRefusal();
  }
  return failed(looked);
}

/**
 * The server, then the write. With `create`, a `create` posts the name (with the id the level
 * row held for it, when it did, so a re-created name keeps the id the teammates joined); without
 * it, a `create` is `unknown-name`; `create` on a `join` is the create's 409 (`exists`), a purged
 * alias `purged`. Then `setLevel` writes with the name's id; a write refused after a create says
 * `named: true` and the one sentence. A join of a re-created name clears its flag and reads the
 * name again from the start. Without `confirm`, `needs-confirm` before any request.
 */
export async function commitBinding(
  ctx: SyncContext,
  prepared: Prepared,
  options: { confirm: boolean; create: boolean },
  hooks: BindHooks = {},
): Promise<BindOutcome> {
  const { input } = prepared;
  const write = (nameId: string | null, recreated: boolean, confirm: boolean) =>
    setLevel(ctx.db, {
      projectId: input.projectId,
      destination: input.destination,
      level: input.level,
      source: input.source,
      now: ctx.clock.now,
      confirm,
      as: prepared.alias,
      remoteAlias: input.remoteAlias ?? null,
      nameId,
      recreated,
    });
  if (prepared.action === "none") {
    const outcome = write(prepared.storedId, false, options.confirm);
    return outcome.ok
      ? { ...outcome, created: false, joined: false, name: null }
      : refusalOf(outcome);
  }
  if (!options.confirm) return { ok: false, reason: "needs-confirm" };
  const server = prepared.server as ServerRow;
  const alias = prepared.alias as string;
  const slug = prepared.slug as string;
  const client = clientFor(ctx, server);
  if (!(client instanceof SyncClient)) return client;

  let item = prepared.name;
  let created = false;
  if (prepared.action === "create" || options.create) {
    if (!options.create) return { ok: false, reason: "unknown-name", name: null };
    const made = await client.createName(alias, prepared.storedId);
    if (made.ok) {
      item = made.body;
      created = true;
    } else if (made.kind === "conflict") {
      if (made.body.error === "purged") return { ok: false, reason: "purged" };
      const name = (made.body.name as NameItemShape | undefined) ?? prepared.name;
      return { ok: false, reason: "exists", name };
    } else if (made.kind === "oldServer") {
      setContract(ctx.db, server.serverId, 1);
      return contractRefusal();
    } else {
      return failed(made);
    }
  }
  hooks.afterServer?.();

  const outcome = write(item?.id ?? null, prepared.state === "recreated", true);
  if (!outcome.ok) {
    return {
      ...refusalOf(outcome),
      ...(created ? { named: true, message: BIND_MESSAGES["created-unbound"](slug) } : {}),
    };
  }
  if (prepared.state === "recreated") rejoinName(ctx, server.serverId, alias);
  clearName(ctx, server.serverId, alias, "missing");
  return {
    ...outcome,
    named: outcome.named || created,
    created,
    joined: !created,
    name: item,
  };
}
