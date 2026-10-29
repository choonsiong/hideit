export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Cryptographically secure RNG backed by crypto.getRandomValues, buffered to avoid a call per character. */
export function createCryptoRng(): Rng {
  const buffer = new Uint32Array(256);
  let index = buffer.length;
  const next = (): number => {
    if (index >= buffer.length) {
      crypto.getRandomValues(buffer);
      index = 0;
    }
    return buffer[index++]!;
  };
  return {
    int(maxExclusive) {
      // Rejection sampling removes modulo bias.
      const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
      let value = next();
      while (value >= limit) value = next();
      return value % maxExclusive;
    },
  };
}

/** Deterministic RNG (mulberry32) for tests. Not for real use. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(maxExclusive) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const float = ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
      return Math.floor(float * maxExclusive);
    },
  };
}

export function pick(rng: Rng, alphabet: string): string {
  return alphabet[rng.int(alphabet.length)]!;
}

export function randomString(rng: Rng, alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += pick(rng, alphabet);
  return out;
}
