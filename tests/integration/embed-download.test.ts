import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteModel, downloadModel, sweepStaleParts } from "../../src/embed/download.ts";
import { MODEL_FILE, modelPath } from "../../src/embed/model.ts";
import { runCliWith } from "../helpers/cli.ts";

const body = Buffer.alloc(300_000, 7);
const sha = createHash("sha256").update(body).digest("hex");

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/ok") return new Response(body);
    if (path === "/slow") {
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(body.subarray(0, 100_000));
            await Bun.sleep(150);
            c.enqueue(body.subarray(100_000));
            c.close();
          },
        }),
        { headers: { "content-length": String(body.length) } },
      );
    }
    if (path === "/short") return new Response(body.subarray(0, 1000));
    if (path === "/html")
      return new Response(Buffer.alloc(body.length, 60), {
        headers: { "content-type": "text/html" },
      });
    if (path === "/stall")
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(body.subarray(0, 10));
          },
        }),
        { headers: { "content-length": String(body.length) } },
      );
    if (path === "/error") return new Response("nope", { status: 503 });
    if (path === "/abort")
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(body.subarray(0, 50_000));
            await Bun.sleep(20);
            c.error(new Error("connection reset"));
          },
        }),
        { headers: { "content-length": String(body.length) } },
      );
    return new Response("missing", { status: 404 });
  },
});
afterAll(() => server.stop(true));

let dataDir: string;
beforeEach(() => {
  dataDir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-embed-dl-")));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const opts = (p: string, extra: object = {}) => ({
  dataDir,
  url: url(p),
  sha256: sha,
  bytes: body.length,
  ...extra,
});
const leftovers = () => {
  const dir = join(dataDir, "models");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f !== MODEL_FILE) : [];
};

describe("downloadModel", () => {
  test("writes the final file with the right hash and reports progress", async () => {
    const seen: Array<[number, number]> = [];
    const out = await downloadModel(
      opts("/ok", { onProgress: (d: number, t: number) => seen.push([d, t]) }),
    );
    expect(out).toEqual({ ok: true });
    expect(
      new Bun.CryptoHasher("sha256")
        .update(await Bun.file(modelPath(dataDir)).bytes())
        .digest("hex"),
    ).toBe(sha);
    expect(seen.at(-1)).toEqual([body.length, body.length]);
    expect(leftovers()).toEqual([]);
  });

  const failures: Array<[string, string, RegExp]> = [
    ["a short body", "/short", /size|bytes/i],
    ["an HTML body", "/html", /html/i],
    ["a server error", "/error", /503/],
    ["an aborted stream", "/abort", /./],
  ];
  for (const [name, path, reason] of failures) {
    test(`${name} leaves no final file and no part file`, async () => {
      const out = await downloadModel(opts(path));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(reason);
      expect(existsSync(modelPath(dataDir))).toBe(false);
      expect(leftovers()).toEqual([]);
    });
  }

  test("a wrong hash leaves nothing and says so", async () => {
    const out = await downloadModel(opts("/ok", { sha256: "0".repeat(64) }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/checksum|sha256/i);
    expect(existsSync(modelPath(dataDir))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test("a fetch that throws (no network) is a reason, and a retry works", async () => {
    const down = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const first = await downloadModel(opts("/ok", { fetch: down }));
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toContain("ENOTFOUND");
    expect(await downloadModel(opts("/ok"))).toEqual({ ok: true });
  });

  test("a second download over a valid file is a no-op", async () => {
    await downloadModel(opts("/ok"));
    const out = await downloadModel(opts("/error"));
    expect(out).toEqual({ ok: true, alreadyPresent: true });
  });

  test("an existing file of the wrong content is replaced", async () => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    writeFileSync(modelPath(dataDir), "garbage");
    expect(await downloadModel(opts("/ok"))).toEqual({ ok: true });
    expect((await Bun.file(modelPath(dataDir)).bytes()).length).toBe(body.length);
  });

  test("two downloads at once do not corrupt each other", async () => {
    const [a, b] = await Promise.all([downloadModel(opts("/slow")), downloadModel(opts("/slow"))]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(
      new Bun.CryptoHasher("sha256")
        .update(await Bun.file(modelPath(dataDir)).bytes())
        .digest("hex"),
    ).toBe(sha);
    expect(leftovers()).toEqual([]);
  });
});

describe("leftovers and stalls", () => {
  const plant = (name: string, ageMs = 0) => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    const path = join(dataDir, "models", name);
    writeFileSync(path, "partial");
    const t = new Date(Date.now() - ageMs);
    utimesSync(path, t, t);
    return path;
  };

  test("sweeps a dead owner's part and an old one; keeps a live fresh one", async () => {
    const dead = plant(`.${MODEL_FILE}.99999999.aa.part`);
    const old = plant(`.${MODEL_FILE}.${process.pid}.bb.part`, 11 * 60_000);
    const live = plant(`.${MODEL_FILE}.${process.pid}.cc.part`);
    const other = plant("unrelated.txt", 11 * 60_000);
    sweepStaleParts(dataDir);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  test("a download sweeps leftovers first", async () => {
    const dead = plant(`.${MODEL_FILE}.99999999.aa.part`);
    expect((await downloadModel(opts("/ok"))).ok).toBe(true);
    expect(existsSync(dead)).toBe(false);
  });

  test("a stalled stream is aborted with a clear message and leaves nothing", async () => {
    const out = await downloadModel(opts("/stall", { idleTimeoutMs: 100 }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/no data|stalled/);
    expect(existsSync(modelPath(dataDir))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test("deleteModel reports whether the file is gone", () => {
    expect(deleteModel(dataDir)).toBe(true);
    plant(MODEL_FILE);
    expect(deleteModel(dataDir)).toBe(true);
    expect(existsSync(modelPath(dataDir))).toBe(false);
  });
});

describe("embed command and deleteModel", () => {
  const embed = (...args: string[]) =>
    runCliWith(
      {
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: dataDir,
          WIZARDINGCODE_MEM_MIGRATE: "off",
          WIZARDINGCODE_MEM_SEMANTIC: "on",
        },
      },
      "embed",
      ...args,
    );

  test("status says absent, then present with bytes; delete removes it", async () => {
    const absent = await embed("status");
    expect(absent.exitCode).toBe(0);
    expect(absent.stdout).toMatch(/present: no/);
    expect(absent.stdout).toMatch(/enabled: yes/);
    mkdirSync(join(dataDir, "models"), { recursive: true });
    writeFileSync(modelPath(dataDir), "xx");
    const present = await embed("status");
    expect(present.stdout).toMatch(/present: yes/);
    expect(present.stdout).toContain("bytes: 2");
    const gone = await embed("delete");
    expect(gone.exitCode).toBe(0);
    expect(existsSync(modelPath(dataDir))).toBe(false);
  });

  test("deleteModel is quiet when there is nothing", () => {
    expect(() => deleteModel(dataDir)).not.toThrow();
  });

  test("an unknown subcommand is a usage error", async () => {
    expect((await embed("bogus")).exitCode).toBe(64);
  });
});
