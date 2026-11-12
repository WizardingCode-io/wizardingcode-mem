import { describe, expect, test } from "bun:test";
import { Bucket, createBuckets } from "../../src/team/limits.ts";

const MIB = 1024 * 1024;

describe("the token bucket", () => {
  test("600 a minute: the 601st is refused with retryAfterSec of at least 1, and the clock refills", () => {
    let now = 0;
    const bucket = new Bucket(600, 10, () => now);
    for (let i = 0; i < 600; i++) expect(bucket.take("device").ok).toBe(true);
    expect(bucket.take("device")).toEqual({ ok: false, retryAfterSec: 1 });
    // Another key has its own tokens.
    expect(bucket.take("other").ok).toBe(true);
    now += 100;
    expect(bucket.take("device").ok).toBe(true);
    expect(bucket.take("device").ok).toBe(false);
    now += 60_000;
    for (let i = 0; i < 600; i++) expect(bucket.take("device").ok).toBe(true);
    expect(bucket.take("device").ok).toBe(false);
  });

  test("a bytes bucket of 64 MiB an hour is taken by size and never over its capacity", () => {
    let now = 0;
    const bucket = new Bucket(64 * MIB, (64 * MIB) / 3600, () => now);
    expect(bucket.take("device", 32 * MIB).ok).toBe(true);
    expect(bucket.take("device", 32 * MIB).ok).toBe(true);
    const refused = bucket.take("device", 1);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1);
    now += 3_600_000;
    expect(bucket.take("device", 64 * MIB).ok).toBe(true);
    now += 7_200_000;
    expect(bucket.take("device", 64 * MIB + 1).ok).toBe(false);
  });

  test("sweep drops the keys idle for ten minutes and keeps the rest", () => {
    let now = 0;
    const bucket = new Bucket(10, 1, () => now);
    bucket.take("old");
    now += 10 * 60_000 + 1;
    bucket.take("fresh");
    expect(bucket.size()).toBe(2);
    bucket.sweep();
    expect(bucket.size()).toBe(1);
    expect(bucket.take("fresh").ok).toBe(true);
  });

  test("createBuckets builds the three buckets from the limits", () => {
    let now = 0;
    const buckets = createBuckets(
      {
        requestsPerMinute: 600,
        joinsPerMinute: 10,
        payloadBytesPerHour: 64 * MIB,
        authFailuresPerMinute: 60,
        namesPerHour: 10,
      },
      () => now,
    );
    for (let i = 0; i < 60; i++) expect(buckets.auth.take("1.2.3.4").ok).toBe(true);
    expect(buckets.auth.take("1.2.3.4")).toEqual({ ok: false, retryAfterSec: 1 });
    for (let i = 0; i < 10; i++) expect(buckets.joins.take("1.2.3.4").ok).toBe(true);
    expect(buckets.joins.take("1.2.3.4")).toEqual({ ok: false, retryAfterSec: 6 });
    for (let i = 0; i < 600; i++) expect(buckets.devices.take("d").ok).toBe(true);
    expect(buckets.devices.take("d").ok).toBe(false);
    expect(buckets.bytes.take("d", 64 * MIB).ok).toBe(true);
    expect(buckets.bytes.take("d", 1).ok).toBe(false);
    now += 60_000;
    expect(buckets.joins.take("1.2.3.4").ok).toBe(true);
  });
});
