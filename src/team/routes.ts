// The route table and the one handler: the request id, the proxy rule, the body cap, the
// contract, the authentication, the problem shape, the log line.
import type { Server } from "bun";
import { json, jsonObject, problem } from "../http/respond.ts";
import { audit, readAudit } from "./audit.ts";
import { authenticate, type Caller, checkContract, requireAdmin } from "./auth.ts";
import { CONTRACT } from "./contract.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import { newHexId, REQUEST_ID } from "./ids.ts";
import type { Buckets } from "./limits.ts";
import type { TeamLog } from "./log.ts";
import {
  checkExpiry,
  checkLabel,
  checkName,
  checkRole,
  disableMember,
  enableMember,
  join,
  listDevices,
  listInvitations,
  listMembers,
  mintInvitation,
  revokeDevice,
  revokeInvitation,
  rotateToken,
  setRole,
} from "./members.ts";
import type { ChangeSignal } from "./signal.ts";

export interface Limits {
  bodyBytes: number;
  itemsPerPush: number;
  itemBytes: number;
  pullItems: number;
  pullBytes: number;
  pullWaitSeconds: number;
  requestsPerMinute: number;
  payloadBytesPerHour: number;
  joinsPerMinute: number;
  minFreeBytes: number;
  minFreeBytesHealth: number;
}

export interface Context {
  db: Db;
  now: () => number;
  serverId: string;
  instance: () => string;
  trustProxy: boolean;
  limits: Limits;
  buckets: Buckets;
  signal: ChangeSignal;
  freeBytes: (path: string) => number | null;
  dataDir: string;
  log: TeamLog;
  /** After a route wrote a feed or an audit row: the high-water file always, the signal and the mirror timer when `feed`. */
  onWrite: (what: { feed: boolean }) => void;
  /** Phase C and D fill these; until then the routes answer 501. */
  push?: (
    ctx: Context,
    caller: Caller,
    body: Record<string, unknown>,
    request: Request,
  ) => Promise<unknown>;
  pull?: (ctx: Context, caller: Caller, url: URL) => Promise<unknown>;
  withdraw?: (ctx: Context, caller: Caller, kind: string, uid: string) => unknown;
  reinstate?: (ctx: Context, caller: Caller, kind: string, uid: string) => unknown;
  tombstoneMemberItems?: (ctx: Context, memberId: string, caller: Caller) => number;
}

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

/** Reads a JSON object body, refusing one over the cap by what it reads, not only by its header. */
async function readBody(ctx: Context, request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ctx.limits.bodyBytes) throw new HttpError(413, { error: "body too large" });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > ctx.limits.bodyBytes)
    throw new HttpError(413, { error: "body too large" });
  const parsed = await jsonObject(new Request(request.url, { method: "POST", body: bytes }));
  if (parsed instanceof Response) {
    const body = (await parsed.json()) as { error: string };
    throw new HttpError(400, { error: body.error });
  }
  return parsed;
}

const ids = (ctx: Context) => ({ serverId: ctx.serverId, instance: ctx.instance() });

async function withCaller(ctx: Context, request: Request, admin: boolean): Promise<Caller> {
  checkContract(request);
  const caller = authenticate(ctx.db, request, ctx.now());
  const taken = ctx.buckets.devices.take(caller.device.id);
  if (!taken.ok) {
    throw new HttpError(429, { error: "rate limited", retryAfterSec: taken.retryAfterSec });
  }
  if (admin) requireAdmin(caller);
  return caller;
}

const notImplemented = () => problem(501, "not implemented");

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
    if (!taken.ok)
      throw new HttpError(429, { error: "rate limited", retryAfterSec: taken.retryAfterSec });
    const body = await readBody(ctx, request);
    const code = typeof body.code === "string" ? body.code : "";
    const label = checkLabel(body.label);
    const name = body.name === undefined ? undefined : checkName(body.name);
    const now = ctx.now();
    try {
      const joined = join(ctx.db, { code, label, now, ...(name === undefined ? {} : { name }) });
      audit(ctx.db, {
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
        audit(ctx.db, {
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

  route("GET", "/v1/me", async (ctx, request) => {
    const caller = await withCaller(ctx, request, false);
    return json({
      member: { id: caller.member.id, name: caller.member.name, role: caller.member.role },
      device: { id: caller.device.id, alias: caller.device.alias, label: caller.device.label },
      ...ids(ctx),
      contract: CONTRACT,
      now: ctx.now(),
      limits: ctx.limits,
    });
  }),

  route("POST", "/v1/devices/me/rotate", async (ctx, request, _params, address) => {
    const caller = await withCaller(ctx, request, false);
    const token = rotateToken(ctx.db, caller.device.id);
    audit(ctx.db, {
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

  route("POST", "/v1/push", async (ctx, request) => {
    const caller = await withCaller(ctx, request, false);
    if (ctx.push === undefined) return notImplemented();
    const body = await readBody(ctx, request);
    return json(await ctx.push(ctx, caller, body, request));
  }),

  route("GET", "/v1/pull", async (ctx, request) => {
    const caller = await withCaller(ctx, request, false);
    if (ctx.pull === undefined) return notImplemented();
    return json(await ctx.pull(ctx, caller, new URL(request.url)));
  }),

  route("POST", "/v1/invitations", async (ctx, request, _params, address) => {
    const caller = await withCaller(ctx, request, true);
    const body = await readBody(ctx, request);
    const now = ctx.now();
    const expiresInHours = checkExpiry(body.expiresInHours);
    const made =
      body.forMember !== undefined
        ? mintInvitation(ctx.db, {
            role: "member",
            name: null,
            forMember: typeof body.forMember === "string" ? body.forMember : "",
            createdByDevice: caller.device.id,
            expiresInHours,
            now,
          })
        : mintInvitation(ctx.db, {
            role: checkRole(body.role),
            name: checkName(body.name),
            forMember: null,
            createdByDevice: caller.device.id,
            expiresInHours,
            now,
          });
    audit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "invitation made",
      target: made.invitation.id,
      detail:
        made.invitation.forMember === null
          ? `${made.invitation.role} ${made.invitation.name}`
          : `device for ${made.invitation.forMember}`,
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

  route("GET", "/v1/invitations", async (ctx, request) => {
    await withCaller(ctx, request, true);
    return json({ invitations: listInvitations(ctx.db, ctx.now()) });
  }),

  route("POST", "/v1/invitations/:id/revoke", async (ctx, request, params, address) => {
    const caller = await withCaller(ctx, request, true);
    const now = ctx.now();
    if (!revokeInvitation(ctx.db, params.id as string, now))
      throw new HttpError(404, { error: "invitation unknown" });
    audit(ctx.db, {
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

  route("GET", "/v1/members", async (ctx, request) => {
    await withCaller(ctx, request, true);
    return json({ members: listMembers(ctx.db) });
  }),

  route("GET", "/v1/devices", async (ctx, request) => {
    await withCaller(ctx, request, true);
    const member = new URL(request.url).searchParams.get("member");
    return json({ devices: listDevices(ctx.db, member ?? undefined) });
  }),

  route("POST", "/v1/devices/:id/revoke", async (ctx, request, params, address) => {
    const caller = await withCaller(ctx, request, true);
    const now = ctx.now();
    revokeDevice(ctx.db, params.id as string, now);
    audit(ctx.db, {
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

  route("POST", "/v1/members/:id/disable", async (ctx, request, params, address) => {
    const caller = await withCaller(ctx, request, true);
    const body = await readBody(ctx, request);
    const now = ctx.now();
    const id = params.id as string;
    const { devices } = disableMember(ctx.db, id, now);
    const withdrawn =
      body.withdraw === true && ctx.tombstoneMemberItems !== undefined
        ? ctx.tombstoneMemberItems(ctx, id, caller)
        : 0;
    audit(ctx.db, {
      at: now,
      source: "api",
      deviceId: caller.device.id,
      address,
      action: "member disabled",
      target: id,
      detail: `devices ${devices}, withdrawn ${withdrawn}`,
    });
    ctx.onWrite({ feed: withdrawn > 0 });
    return json({ id, disabledAt: now, devices, withdrawn });
  }),

  route("POST", "/v1/members/:id/enable", async (ctx, request, params, address) => {
    const caller = await withCaller(ctx, request, true);
    const now = ctx.now();
    enableMember(ctx.db, params.id as string);
    audit(ctx.db, {
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

  route("POST", "/v1/members/:id/role", async (ctx, request, params, address) => {
    const caller = await withCaller(ctx, request, true);
    const body = await readBody(ctx, request);
    const role = checkRole(body.role);
    const now = ctx.now();
    setRole(ctx.db, params.id as string, role);
    audit(ctx.db, {
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

  route("POST", "/v1/items/:kind/:uid/withdraw", async (ctx, request, params) => {
    const caller = await withCaller(ctx, request, true);
    if (ctx.withdraw === undefined) return notImplemented();
    return json(ctx.withdraw(ctx, caller, params.kind as string, params.uid as string));
  }),

  route("POST", "/v1/items/:kind/:uid/reinstate", async (ctx, request, params) => {
    const caller = await withCaller(ctx, request, true);
    if (ctx.reinstate === undefined) return notImplemented();
    return json(ctx.reinstate(ctx, caller, params.kind as string, params.uid as string));
  }),

  route("GET", "/v1/audit", async (ctx, request) => {
    await withCaller(ctx, request, true);
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
  const own = request.headers.get("x-request-id");
  const requestId = own !== null && REQUEST_ID.test(own) ? own : newHexId();
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const address = clientAddress(request, server, ctx.trustProxy);
  const routeName = `${request.method} ${url.pathname}`;
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
  response.headers.set("x-request-id", requestId);
  ctx.log.request({
    requestId,
    route: routeName,
    status: response.status,
    ms: ctx.now() - started,
    address,
  });
  return response;
}
