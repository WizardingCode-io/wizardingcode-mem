// The look at the registry (ADR 0033): which digest `latest` names, asked with no login and
// no image downloaded. Every answer but a 200 with a digest is "no digest".
import { describe, expect, test } from "bun:test";
import { latestDigest } from "../../src/host/registry.ts";

const DIGEST = `sha256:${"c".repeat(64)}`;
const TARGET = { image: "ghcr.io/acme/tool", registry: "https://ghcr.io" };
const MANIFEST = "https://ghcr.io/v2/acme/tool/manifests/latest";
const CHALLENGE =
  'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/tool:pull"';

type Seen = { url: string; method: string; headers: Record<string, string>; redirect?: string };
type Reply = Response | Error;
function fetcher(replies: Array<(seen: Seen) => Reply>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const stub = async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
    };
    seen.push(call);
    const reply = replies[seen.length - 1];
    if (reply === undefined) throw new Error(`unscripted request ${call.url}`);
    const answer = reply(call);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch: stub as unknown as typeof fetch, seen };
}
const ok = (digest: string) =>
  new Response(null, { status: 200, headers: { "docker-content-digest": digest } });
const unauthorized = (challenge: string) =>
  new Response(null, { status: 401, headers: { "www-authenticate": challenge } });
const look = (f: typeof fetch) => latestDigest({ fetch: f, target: TARGET, timeoutMs: 1000 });

describe("latestDigest", () => {
  test("asks for an index or a manifest, follows a Bearer challenge to its realm, and gives the digest", async () => {
    const { fetch, seen } = fetcher([
      () => unauthorized(CHALLENGE),
      () => Response.json({ token: "t0k" }),
      () => ok(DIGEST),
    ]);
    expect(await look(fetch)).toBe(DIGEST);
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ["HEAD", MANIFEST],
      ["GET", "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aacme%2Ftool%3Apull"],
      ["HEAD", MANIFEST],
    ]);
    const accept = (seen[0]?.headers.accept ?? "").split(",").map((part) => part.trim());
    expect(accept.sort()).toEqual(
      [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ].sort(),
    );
    expect(seen[2]?.headers.accept).toBe(seen[0]?.headers.accept);
    expect(seen[2]?.headers.authorization).toBe("Bearer t0k");
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(seen.map((s) => s.redirect)).toEqual(["manual", "manual", "manual"]);
  });

  test("a registry that answers at once needs no token", async () => {
    const { fetch, seen } = fetcher([() => ok(DIGEST)]);
    expect(await look(fetch)).toBe(DIGEST);
    expect(seen).toHaveLength(1);
  });

  test("a registry by its own address, as the scenarios name one", async () => {
    const { fetch, seen } = fetcher([() => ok(DIGEST)]);
    const got = await latestDigest({
      fetch,
      target: { image: "localhost:5001/wcm", registry: "http://localhost:5001" },
      timeoutMs: 1000,
    });
    expect(got).toBe(DIGEST);
    expect(seen[0]?.url).toBe("http://localhost:5001/v2/wcm/manifests/latest");
  });

  test("every other answer is no digest", async () => {
    const cases: Array<[string, Array<(seen: Seen) => Reply>]> = [
      ["a 404", [() => new Response(null, { status: 404 })]],
      ["a header that is no digest", [() => ok("latest")]],
      ["no header", [() => new Response(null, { status: 200 })]],
      [
        "a redirect",
        [() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } })],
      ],
      [
        "a challenge whose realm is not https",
        [() => unauthorized(CHALLENGE.replace("https://ghcr.io/token", "http://ghcr.io/token"))],
      ],
      ["a challenge that is not Bearer", [() => unauthorized('Basic realm="x"')]],
      ["a token answer with no token", [() => unauthorized(CHALLENGE), () => Response.json({})]],
      [
        "a second 401",
        [
          () => unauthorized(CHALLENGE),
          () => Response.json({ token: "t" }),
          () => unauthorized(CHALLENGE),
        ],
      ],
      ["a bound exceeded", [() => new DOMException("timed out", "TimeoutError")]],
      ["a network failure", [() => new TypeError("fetch failed")]],
    ];
    for (const [name, replies] of cases) {
      const { fetch } = fetcher(replies);
      expect({ name, got: await look(fetch) }).toEqual({ name, got: null });
    }
  });

  test("each request carries its own bound", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const stub = (async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      return ok(DIGEST);
    }) as unknown as typeof fetch;
    await look(stub);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
