// The look at the registry (ADR 0033): which digest the tag `latest` names. Asked by the tool
// itself, with no login and no image downloaded, so a host needs no plugin for it. Anything
// but a 200 with a digest is "no digest", which the rule reads as "could not check".
import { DIGEST } from "./signature.ts";

/** An index first; a single manifest too, for a registry that holds a one-platform image. */
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export interface Look {
  fetch: typeof fetch;
  /** `image` is `<host>/<path>`; `registry` the address the requests go to. */
  target: { image: string; registry: string };
  /** The bound of each request. */
  timeoutMs: number;
}

/** `realm`, `service` and `scope` of a `Bearer` challenge; null for anything else. */
function challengeOf(
  header: string | null,
  registry: string,
): { realm: URL; service: string; scope: string } | null {
  if (header === null || !/^Bearer\s/i.test(header)) return null;
  const part = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(header)?.[1];
  const realm = part("realm");
  if (realm === undefined) return null;
  let url: URL;
  try {
    url = new URL(realm);
  } catch {
    return null;
  }
  // A token is asked only of an https address on the registry's own host: the challenge is
  // the registry's word, and it must not send a request anywhere else.
  if (url.protocol !== "https:" || url.host !== new URL(registry).host) return null;
  return { realm: url, service: part("service") ?? "", scope: part("scope") ?? "" };
}

/** The index digest `latest` names in the target's repository, or null. */
export async function latestDigest(look: Look): Promise<string | null> {
  const path = look.target.image.slice(look.target.image.indexOf("/") + 1);
  const manifest = `${look.target.registry}/v2/${path}/manifests/latest`;
  const ask = (url: string, method: string, headers: Record<string, string>) =>
    look.fetch(url, {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(look.timeoutMs),
    });
  const digestOf = (response: Response): string | null => {
    if (response.status !== 200) return null;
    const digest = response.headers.get("docker-content-digest") ?? "";
    return DIGEST.test(digest) ? digest : null;
  };
  try {
    const first = await ask(manifest, "HEAD", { accept: ACCEPT });
    if (first.status !== 401) return digestOf(first);
    const challenge = challengeOf(first.headers.get("www-authenticate"), look.target.registry);
    if (challenge === null) return null;
    const tokenUrl = new URL(challenge.realm);
    tokenUrl.searchParams.set("service", challenge.service);
    tokenUrl.searchParams.set("scope", challenge.scope);
    const answer = await ask(tokenUrl.toString(), "GET", {});
    if (answer.status !== 200) return null;
    const token = ((await answer.json()) as { token?: unknown }).token;
    if (typeof token !== "string" || token === "") return null;
    return digestOf(
      await ask(manifest, "HEAD", { accept: ACCEPT, authorization: `Bearer ${token}` }),
    );
  } catch {
    return null;
  }
}
