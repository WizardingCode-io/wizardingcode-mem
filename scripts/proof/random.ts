// Seeded draws for the proofs, so that a sample or an example comes back on a rerun.

/** Deterministic pseudo-random whole numbers below `max`, from a seed. */
export function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

/** `n` items drawn without replacement, in the order drawn. */
export function sample<T>(items: T[], n: number, next: (max: number) => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(next(pool.length), 1)[0] as T);
  return out;
}
