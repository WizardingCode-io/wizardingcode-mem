// HTTP to one team server (ADR 0027): the contract header, the bearer token, a request id of
// the contract's grammar on every request, a 3xx never followed, and every answer mapped to a
// typed one, so the loop never reads a status code. The deadline runs on the injected timers.
import { randomUUID } from "node:crypto";
import {
  CONTRACT,
  CONTRACT_HEADER,
  isLoopback,
  type JoinAnswer,
  type MeAnswer,
  type NameItemShape,
  type NamesPageShape,
  type PullPageShape,
  type PushItemShape,
  type PushResultShape,
  REQUEST_ID_HEADER,
} from "../team/contract.ts";
import type { SyncContext } from "./context.ts";

// --- The URL ----------------------------------------------------------------------------------

export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerUrlError";
  }
}

/**
 * A server URL as the client accepts it: an origin (no path, query or fragment), with no
 * credentials, `https://` unless the host is loopback. The origin is what is stored.
 */
export function checkServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServerUrlError(`${raw} is not a URL`);
  }
  if (url.username !== "" || url.password !== "")
    throw new ServerUrlError("the server URL carries credentials; the token is the device's");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
    throw new ServerUrlError("the server URL needs https:// (http:// only for a loopback host)");
  if (url.search !== "" || url.hash !== "")
    throw new ServerUrlError("the server URL is an origin, without a query or a fragment");
  if (url.pathname !== "/" && url.pathname !== "")
    throw new ServerUrlError("the server URL is an origin, without a path");
  return url.origin;
}

// --- The answers --------------------------------------------------------------------------------

export type ClientFailure =
  | { kind: "unauthorized"; status: 401; error: string; instance: string | null }
  | { kind: "disabled"; status: 403; error: string }
  | { kind: "forbidden"; status: 403; error: string }
  | { kind: "contract"; status: 409; accepted: number[] }
  /** A 409 with no accepted list: a names route's `exists` or `purged`, with the body (ADR 0028). */
  | { kind: "conflict"; status: 409; error: string; body: Record<string, unknown> }
  /** A names route answered the route table's own 404: a server that speaks 1 (ADR 0028). */
  | { kind: "oldServer"; status: 404; error: string }
  | { kind: "gone"; status: 410; error: string; instance: string | null }
  | { kind: "tooLarge"; status: 413 }
  | { kind: "rate"; status: 429; retryAfterMs: number }
  | { kind: "refused"; status: number; error: string; body: Record<string, unknown> }
  | { kind: "server"; status: number; error: string }
  | { kind: "redirect"; status: number | null }
  | { kind: "network"; error: string }
  | { kind: "deadline" }
  | { kind: "aborted" };

export type ClientAnswer<T> =
  | { ok: true; status: number; body: T; requestId: string }
  | ({ ok: false; requestId: string | null } & ClientFailure);

export type ClientFailed = Extract<ClientAnswer<never>, { ok: false }>;

/** A pull as the client makes it: the server's page size is its own (`pullItems`, `pullBytes`). */
export interface PullInput {
  since: number;
  scope: "all" | "project";
  projects?: readonly string[];
  wait?: number;
}

export interface RequestOptions {
  /** The caller's stop: the request ends as `aborted`. */
  signal?: AbortSignal;
  /** How long the whole request may take, on the context's timers; past it, `deadline`. */
  deadlineMs?: number;
}

/** A pull not held waits this long for the whole answer; a held one adds the server's wait. */
export const DEFAULT_DEADLINE_MS = 30_000;
/** A rate limit the server names no wait for. */
const RATE_DEFAULT_MS = 10_000;

const requestId = (): string => randomUUID().replaceAll("-", "");

function retryAfterMs(response: Response, body: Record<string, unknown>): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const field = body.retryAfterSec;
  return typeof field === "number" && field > 0 ? field * 1000 : RATE_DEFAULT_MS;
}

const text = (body: Record<string, unknown>, key: string): string | null =>
  typeof body[key] === "string" ? (body[key] as string) : null;

/** The failure a status and a body mean to the client; `names` says the request was a names route's. */
function failureOf(
  response: Response,
  body: Record<string, unknown>,
  names: boolean,
): ClientFailure {
  const status = response.status;
  const error = text(body, "error") ?? `status ${status}`;
  const instance = text(body, "instance");
  if (status >= 300 && status < 400) return { kind: "redirect", status };
  if (status === 401) return { kind: "unauthorized", status, error, instance };
  if (status === 403)
    return error === "member disabled"
      ? { kind: "disabled", status, error }
      : { kind: "forbidden", status, error };
  if (status === 409) {
    // The contract's 409 carries the accepted list; a names route's 409 (exists, purged) does not.
    if (Array.isArray(body.accepted)) {
      const accepted = body.accepted.filter((value): value is number => typeof value === "number");
      return { kind: "contract", status, accepted };
    }
    return { kind: "conflict", status, error, body };
  }
  if (status === 404 && names && error === "not found") return { kind: "oldServer", status, error };
  if (status === 410) return { kind: "gone", status, error, instance };
  if (status === 413) return { kind: "tooLarge", status };
  if (status === 429) return { kind: "rate", status, retryAfterMs: retryAfterMs(response, body) };
  if (status >= 500) return { kind: "server", status, error };
  return { kind: "refused", status, error, body };
}

// --- The client --------------------------------------------------------------------------------

export interface ClientOptions {
  url: string;
  /** Null before a join: the join sends none. */
  token: string | null;
  /** The contract named in the header; the binary's unless a test says otherwise. */
  contract?: number;
}

/** One server, one token. Every request goes through `request`, which never throws. */
export class SyncClient {
  private readonly url: string;
  private readonly token: string | null;
  private spoken: number;

  constructor(
    private readonly ctx: SyncContext,
    options: ClientOptions,
  ) {
    this.url = options.url.replace(/\/+$/, "");
    this.token = options.token;
    this.spoken = options.contract ?? CONTRACT;
  }

  /** The contract named in the header now. */
  get contract(): number {
    return this.spoken;
  }

  /** Speaks another contract from the next request on: the live path down to a server at 1 (ADR 0028). */
  speak(contract: number): void {
    this.spoken = contract;
  }

  join(code: string, label: string, name?: string): Promise<ClientAnswer<JoinAnswer>> {
    return this.request<JoinAnswer>(
      "POST",
      "/v1/join",
      { code, label, ...(name === undefined ? {} : { name }) },
      {},
      { token: false },
    );
  }

  me(options: RequestOptions = {}): Promise<ClientAnswer<MeAnswer>> {
    return this.request<MeAnswer>("GET", "/v1/me", undefined, options);
  }

  /** The items in the spec's order; a withdraw is an item of `op: "withdraw"`. A push is never held, so it takes the default deadline. */
  push(
    items: PushItemShape[],
    epoch: number,
  ): Promise<ClientAnswer<{ results: PushResultShape[] }>> {
    return this.request<{ results: PushResultShape[] }>("POST", "/v1/push", { items, epoch }, {});
  }

  /** `POST /v1/names`: creates the name, with the id given when it is the creator's stored one (ADR 0028). */
  createName(alias: string, id?: string | null): Promise<ClientAnswer<NameItemShape>> {
    return this.request<NameItemShape>(
      "POST",
      "/v1/names",
      { alias, ...(id === undefined || id === null ? {} : { id }) },
      {},
      { names: true },
    );
  }

  /** `GET /v1/names/<alias>`: the live name's item; `refused` with `unknown-name` otherwise. */
  nameByAlias(alias: string): Promise<ClientAnswer<NameItemShape>> {
    return this.request<NameItemShape>(
      "GET",
      `/v1/names/${encodeURIComponent(alias)}`,
      undefined,
      {},
      { names: true },
    );
  }

  /** `GET /v1/names`: one page of the live names after `after`. */
  listNames(after: string | null, limit: number): Promise<ClientAnswer<NamesPageShape>> {
    const params = new URLSearchParams();
    if (after !== null) params.set("after", after);
    params.set("limit", String(limit));
    return this.request<NamesPageShape>(
      "GET",
      `/v1/names?${params.toString()}`,
      undefined,
      {},
      { names: true },
    );
  }

  /** Every live name, page by page, at most `cap` of them; `truncated` when the server holds more. */
  async namesAll(
    cap = 1000,
  ): Promise<
    | { ok: true; names: NameItemShape[]; truncated: boolean }
    | Extract<ClientAnswer<never>, { ok: false }>
  > {
    const names: NameItemShape[] = [];
    let after: string | null = null;
    for (;;) {
      const page: ClientAnswer<NamesPageShape> = await this.listNames(
        after,
        Math.min(200, cap - names.length),
      );
      if (!page.ok) return page;
      names.push(...page.body.items);
      if (!page.body.more || page.body.next === null) return { ok: true, names, truncated: false };
      if (names.length >= cap) return { ok: true, names, truncated: true };
      after = page.body.next;
    }
  }

  pull(input: PullInput, options: RequestOptions = {}): Promise<ClientAnswer<PullPageShape>> {
    const params = new URLSearchParams();
    params.set("since", String(input.since));
    params.set("scope", input.scope);
    if (input.projects !== undefined && input.projects.length > 0)
      params.set("projects", input.projects.join(","));
    if (input.wait !== undefined && input.wait > 0) params.set("wait", String(input.wait));
    return this.request<PullPageShape>("GET", `/v1/pull?${params.toString()}`, undefined, options);
  }

  /**
   * One request: the headers, the deadline on the context's timers, the caller's signal, a
   * 3xx refused, the body read as JSON, the status mapped. Never throws.
   */
  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
    extra: { token?: boolean; names?: boolean } = {},
  ): Promise<ClientAnswer<T>> {
    const id = requestId();
    const headers: Record<string, string> = {
      [CONTRACT_HEADER]: String(this.spoken),
      [REQUEST_ID_HEADER]: id,
      accept: "application/json",
    };
    if (extra.token !== false && this.token !== null)
      headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const controller = new AbortController();
    let why: "deadline" | "aborted" | null = null;
    const onAbort = () => {
      why = "aborted";
      controller.abort();
    };
    if (options.signal?.aborted) return { ok: false, requestId: null, kind: "aborted" };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = this.ctx.timers.setTimeout(() => {
      why = "deadline";
      controller.abort();
    }, options.deadlineMs ?? DEFAULT_DEADLINE_MS);

    let response: Response;
    try {
      response = await this.ctx.fetch(`${this.url}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      this.ctx.timers.clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (why !== null) return { ok: false, requestId: null, kind: why };
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "UnexpectedRedirect" || /redirect/i.test(message))
        return { ok: false, requestId: null, kind: "redirect", status: null };
      return { ok: false, requestId: null, kind: "network", error: message };
    }
    let raw = "";
    try {
      raw = await response.text();
    } catch (error) {
      this.ctx.timers.clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (why !== null) return { ok: false, requestId: null, kind: why };
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, requestId: null, kind: "network", error: message };
    }
    this.ctx.timers.clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    const answered = response.headers.get(REQUEST_ID_HEADER) ?? id;

    let parsed: unknown = null;
    try {
      parsed = raw === "" ? null : JSON.parse(raw);
    } catch {
      return {
        ok: false,
        requestId: answered,
        kind: "server",
        status: response.status,
        error: "the answer is not JSON",
      };
    }
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    if (response.status >= 200 && response.status < 300) {
      if (parsed === null || typeof parsed !== "object")
        return {
          ok: false,
          requestId: answered,
          kind: "server",
          status: response.status,
          error: "the answer is not JSON",
        };
      return { ok: true, status: response.status, body: parsed as T, requestId: answered };
    }
    return { ok: false, requestId: answered, ...failureOf(response, record, extra.names === true) };
  }
}
