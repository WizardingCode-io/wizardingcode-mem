// The route table and the one handler: the request id, the proxy rule, the body cap, the
// contract, the authentication, the problem shape, the log line.
import type { Server } from "bun";
import { json, problem } from "../http/respond.ts";
import { readAudit } from "./audit.ts";
import { authenticate, type Caller, checkContract, requireAdmin } from "./auth.ts";
import { CONTRACT, REQUEST_ID_HEADER, REQUEST_ID_RE } from "./contract.ts";
import { HttpError, unknownItem } from "./errors.ts";
import { parsePullQuery, pullWithWait } from "./feed.ts";
import { newHexId } from "./ids.ts";
import {
  checkLabel,
  checkName,
  checkRole,
  enableMember,
  inviteFrom,
  join,
  listDevices,
  listInvitations,
  listMembers,
  revokeDevice,
  revokeInvitation,
  rotateToken,
  setRole,
} from "./members.ts";
import {
  type Actor,
  applyPush,
  disableWithItems,
  reinstateByAdmin,
  summarizePush,
  withdrawByAdmin,
} from "./push.ts";
import { insertAudit } from "./store.ts";
import type { Context, Meta } from "./types.ts";

const IDS_ON = new Set([401, 403, 409, 410]);

/** The client's address: the last `X-Forwarded-For` hop behind a trusted proxy, else the socket's. */
export function clientAddress(
  request: Request,
  server: Server<unknown>,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded !== null && forwarded.trim() !== "") {
      const hops = forwarded.split(",").map((hop) => hop.trim());
      return hops[hops.length - 1] ?? "unknown";
    }
  }
  return server.requestIP(request)?.address ?? "unknown";
}

/** Behind a trusted proxy every request but health must have come in over https. */
export function requireHttps(request: Request, trustProxy: boolean): void {
  if (trustProxy && request.headers.get("x-forwarded-proto") !== "https") {
    throw new HttpError(400, { error: "https required" });
  }
}

type Params = Record<string, string>;
type Handler = (
  ctx: Context,
  request: Request,
  params: Params,
  address: string,
  meta: Meta,
) => Promise<Response> | Response;
interface Route {
  method: string;
  pattern: string[];
  handler: Handler;
}

/** A route's path, split; `:name` segments bind, URL-decoded. */
const route = (method: string, path: string, handler: Handler): Route => ({
  method,
  pattern: path.split("/").filter((part) => part !== ""),
  handler,
});

function match(pattern: string[], segments: string[]): Params | null {
  if (pattern.length !== segments.length) return null;
  const params: Params = {};
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i] as string;
    const got = segments[i] as string;
    if (want.startsWith(":")) {
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) {
      return null;
    }
  }
  return params;
}

const tooLarge = () => new HttpError(413, { error: "body too large" });

/**
 * Reads what is left of a body and drops it, so the 413 reaches a client still sending
 * instead of a closed socket. Bounded by `Bun.serve`'s own `maxRequestBodySize`.
 */
async function discardRest(reader: { read(): Promise<{ done: boolean }> }): Promise<void> {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // The client gave up first.
  }
}

/** The body's bytes, counted as they arrive: a chunked body past the cap is refused where it crosses it. */
export async function readBounded(request: Request, cap: number): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await discardRest(reader);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Reads a JSON object body, refusing one over the cap by what it reads, not only by its header. */
async function readBody(ctx: Context, request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ctx.limits.bodyBytes) {
    if (request.body !== null) await discardRest(request.body.getReader());
    throw tooLarge();
  }
  const bytes = await readBounded(request, ctx.limits.bodyBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, { error: "body must be JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, { error: "body must be an object" });
  }
  return parsed as Record<string, unknown>;
}

const ids = (ctx: Context) => ({ serverId: ctx.serverId, instance: ctx.instance() });

const rateLimited = (retryAfterSec: number) =>
  new HttpError(429, { error: "rate limited", retryAfterSec });

/**
 * The contract, the token, the device's request bucket, the role. A missing or wrong token
 * counts against the address, so guessing is bounded too.
 */
async function withCaller(
  ctx: Context,
  request: Request,
  admin: boolean,
  address: string,
  meta: Meta,
): Promise<Caller> {
  checkContract(request);
  let caller: Caller;
  try {
    caller = authenticate(ctx.db, request, ctx.now());
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const taken = ctx.buckets.auth.take(address);
      if (!taken.ok) throw rateLimited(taken.retryAfterSec);
    }
    throw error;
  }
  meta.deviceId = caller.device.id;
  meta.memberId = caller.member.id;
  const taken = ctx.buckets.devices.take(caller.device.id);
  if (!taken.ok) throw rateLimited(taken.retryAfterSec);
  if (admin) requireAdmin(caller);
  return caller;
}

const actorOf = (caller: Caller): Actor => ({
  memberId: caller.member.id,
  deviceId: caller.device.id,
});

/** The `:kind` of an item route; anything else names nothing. */
function itemKind(raw: string): "entry" | "memory" {
  if (raw !== "entry" && raw !== "memory") throw unknownItem();
  return raw;
}

const ROUTES: Route[] = [
  route("GET", "/v1/health", (ctx) => {
    const free = ctx.freeBytes(ctx.dataDir);
    if (free !== null && free < ctx.limits.minFreeBytesHealth) {
      return json({ ok: false, error: "low disk" }, 503);
    }
    return json({ ok: true });
  }),

  route("POST", "/v1/join", async (ctx, request, _params, address) => {
    const taken = ctx.buckets.joins.take(address);
    if (!taken.ok) throw rateLimited(taken.retryAfterSec);
    const body = await readBody(ctx, request);
    const code = typeof body.code === "string" ? body.code : "";
    const label = checkLabel(body.label);
    const name = body.name === undefined ? undefined : checkName(body.name);
    const now = ctx.now();
    try {
      const joined = join(ctx.db, { code, label, now, ...(name === undefined ? {} : { name }) });
      insertAudit(ctx.db, {
        at: now,
        source: "api",
        deviceId: joined.device.id,
        address,
        action: "join",
        target: joined.member.id,
        detail: label,
      });
      ctx.onWrite({ feed: false });
      return json({
        token: joined.token,
        deviceId: joined.device.id,
        deviceAlias: joined.device.alias,
        memberId: joined.member.id,
        name: joined.member.name,
        role: joined.member.role,
        contract: CONTRACT,
        ...ids(ctx),
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
        // The address, never the code.
        insertAudit(ctx.db, {
          at: now,
          source: "api",
          address,
          action: "join refused",
          detail: error.body.error as string,
        });
        ctx.onWrite({ feed: false });
      }
      throw error;
    }
  }),

  route("GET", "/v1/me", async (ctx, request, _params, address, meta) => {
    const caller = await withCaller(ctx, request, false, address, meta);
    return json({
      member: { id: caller.member.id, name: caller.member.name, role: caller.member.role },
      device: { id: caller.device.id, alias: caller.device.alias, label: caller.device.label },
      ...ids(ctx),
      contract: CONTRACT,
      now: ctx.now(),
      limits: ctx.limits,
    });
  }),

  route("POST", "/v1/devices/me/rotate", async (ctx, request, _params, address, meta) => {
    const caller = await withCaller(ctx, request, false, address, meta);
    const token = rotateToken(ctx.db, caller.device.id);
    insertAudit(ctx.db, {
      at: ctx.now(),
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "token rotated",
      target: caller.device.id,
    });
    ctx.onWrite({ feed: false });
    return json({ token });
  }),

  route("POST", "/v1/push", async (ctx, request, _params, address, meta) => {
    const caller = await withCaller(ctx, request, false, address, meta);
    const body = await readBody(ctx, request);
    const results = applyPush(ctx, caller, body);
    meta.push = summarizePush(results);
    return json({ results });
  }),

  route("GET", "/v1/pull", async (ctx, request, _params, address, meta) => {
    const caller = await withCaller(ctx, request, false, address, meta);
    const query = parsePullQuery(new URL(request.url), ctx.limits);
    const page = await pullWithWait(
      ctx,
      query,
      { admin: caller.member.role === "admin", deviceId: caller.device.id },
      meta,
    );
    meta.pull = {
      since: query.since,
      next: page.next,
      projects: query.projects.length,
      items: page.items.length,
      snapshot: page.snapshot,
    };
    return json(page);
  }),

  route("POST", "/v1/invitations", async (ctx, request, _params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const body = await readBody(ctx, request);
    const now = ctx.now();
    const made = inviteFrom(ctx.db, body, caller.device.id, now);
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "invitation made",
      target: made.invitation.id,
      detail: made.detail,
    });
    ctx.onWrite({ feed: false });
    return json(
      {
        id: made.invitation.id,
        code: made.code,
        role: made.invitation.role,
        name: made.invitation.name,
        forMember: made.invitation.forMember,
        expiresAt: made.invitation.expiresAt,
      },
      201,
    );
  }),

  route("GET", "/v1/invitations", async (ctx, request, _params, address, meta) => {
    await withCaller(ctx, request, true, address, meta);
    return json({ invitations: listInvitations(ctx.db, ctx.now()) });
  }),

  route("POST", "/v1/invitations/:id/revoke", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const now = ctx.now();
    if (!revokeInvitation(ctx.db, params.id as string, now))
      throw new HttpError(404, { error: "invitation unknown" });
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "invitation revoked",
      target: params.id as string,
    });
    ctx.onWrite({ feed: false });
    return json({ id: params.id, revokedAt: now });
  }),

  route("GET", "/v1/members", async (ctx, request, _params, address, meta) => {
    await withCaller(ctx, request, true, address, meta);
    return json({ members: listMembers(ctx.db) });
  }),

  route("GET", "/v1/devices", async (ctx, request, _params, address, meta) => {
    await withCaller(ctx, request, true, address, meta);
    const member = new URL(request.url).searchParams.get("member");
    return json({ devices: listDevices(ctx.db, member ?? undefined) });
  }),

  route("POST", "/v1/devices/:id/revoke", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const now = ctx.now();
    revokeDevice(ctx.db, params.id as string, now);
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "device revoked",
      target: params.id as string,
    });
    ctx.onWrite({ feed: false });
    return json({ id: params.id, revokedAt: now });
  }),

  route("POST", "/v1/members/:id/disable", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const body = await readBody(ctx, request);
    const now = ctx.now();
    const id = params.id as string;
    const done = disableWithItems(ctx.db, id, now, body.withdraw === true, actorOf(caller));
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "member disabled",
      target: id,
      detail: done.detail,
    });
    ctx.onWrite({ feed: done.withdrawn > 0 });
    return json({ id, disabledAt: now, devices: done.devices, withdrawn: done.withdrawn });
  }),

  route("POST", "/v1/members/:id/enable", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const now = ctx.now();
    enableMember(ctx.db, params.id as string);
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "member enabled",
      target: params.id as string,
    });
    ctx.onWrite({ feed: false });
    return json({ id: params.id });
  }),

  route("POST", "/v1/members/:id/role", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const body = await readBody(ctx, request);
    const role = checkRole(body.role);
    const now = ctx.now();
    setRole(ctx.db, params.id as string, role, now);
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "role set",
      target: params.id as string,
      detail: role,
    });
    ctx.onWrite({ feed: false });
    return json({ id: params.id, role });
  }),

  route("POST", "/v1/items/:kind/:uid/withdraw", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const kind = itemKind(params.kind as string);
    const uid = params.uid as string;
    const now = ctx.now();
    const { revision } = withdrawByAdmin(ctx.db, kind, uid, now, actorOf(caller));
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "item withdrawn",
      target: uid,
      detail: `${kind} revision ${revision}`,
    });
    ctx.onWrite({ feed: true });
    return json({ uid, revision });
  }),

  route("POST", "/v1/items/:kind/:uid/reinstate", async (ctx, request, params, address, meta) => {
    const caller = await withCaller(ctx, request, true, address, meta);
    const kind = itemKind(params.kind as string);
    const uid = params.uid as string;
    const now = ctx.now();
    reinstateByAdmin(ctx.db, kind, uid);
    insertAudit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "item reinstated",
      target: uid,
      detail: kind,
    });
    ctx.onWrite({ feed: false });
    return json({ uid });
  }),

  route("GET", "/v1/audit", async (ctx, request, _params, address, meta) => {
    await withCaller(ctx, request, true, address, meta);
    const limit = new URL(request.url).searchParams.get("limit");
    return json({ rows: readAudit(ctx.db, limit === null ? undefined : Number(limit)) });
  }),
];

/** One handler for every request: never throws, always answers with a request id and a log line. */
export async function handle(
  ctx: Context,
  request: Request,
  server: Server<unknown>,
): Promise<Response> {
  const started = ctx.now();
  const own = request.headers.get(REQUEST_ID_HEADER);
  const requestId = own !== null && REQUEST_ID_RE.test(own) ? own : newHexId();
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const address = clientAddress(request, server, ctx.trustProxy);
  const routeName = `${request.method} ${url.pathname}`;
  const meta: Meta = {};
  let response: Response;
  try {
    const sameRoute = ROUTES.filter((candidate) => match(candidate.pattern, segments) !== null);
    const found = sameRoute.find((candidate) => candidate.method === request.method);
    if (found === undefined) {
      response =
        sameRoute.length > 0 ? problem(405, "method not allowed") : problem(404, "not found");
    } else {
      const isHealth = found.pattern.join("/") === "v1/health";
      if (!isHealth) requireHttps(request, ctx.trustProxy);
      response = await found.handler(
        ctx,
        request,
        match(found.pattern, segments) as Params,
        address,
        meta,
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      const extra: Record<string, unknown> = { ...error.body };
      delete extra.error;
      if (IDS_ON.has(error.status)) Object.assign(extra, ids(ctx));
      const headers: Record<string, string> = {};
      if (error.status === 429 && typeof extra.retryAfterSec === "number") {
        headers["retry-after"] = String(extra.retryAfterSec);
        delete extra.retryAfterSec;
      }
      response = json({ error: error.body.error, ...extra }, error.status, headers);
    } else {
      ctx.log.error("team.request", error, requestId);
      response = problem(500, "internal error", { requestId });
    }
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  ctx.log.request({
    requestId,
    route: routeName,
    status: response.status,
    ms: ctx.now() - started,
    address,
    ...meta,
  });
  return response;
}
