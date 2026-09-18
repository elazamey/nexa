/**
 * Shared, non-serializable test inputs.
 *
 * JSON cannot express `undefined`, functions, BigInt, NaN or lone surrogates, so
 * rejection vectors name a factory instead of carrying a literal. Both
 * `tools/vectors.mjs` (generation) and `tests/vectors.test.js` (verification) use
 * these exact factories, so the vector file and the test cannot drift apart.
 */
export const REJECTION_FACTORIES = Object.freeze({
  float: () => ({ x: 1.5 }),
  'float-in-array': () => [0.1],
  undefined: () => ({ x: undefined }),
  bigint: () => ({ x: 1n }),
  function: () => ({ x: () => 1 }),
  date: () => ({ x: new Date(0) }),
  map: () => ({ x: new Map() }),
  set: () => ({ x: new Set() }),
  'class-instance': () => {
    class Widget {
      constructor() {
        this.kind = 'widget';
      }
    }
    return { x: new Widget() };
  },
  'lone-surrogate': () => ({ x: '\ud800' }),
  'lone-low-surrogate': () => ({ x: '\udc00' }),
  nan: () => ({ x: Number.NaN }),
  infinity: () => ({ x: Number.POSITIVE_INFINITY }),
  'unsafe-integer': () => ({ x: 2 ** 53 + 2 }),
  symbol: () => ({ x: Symbol('nope') }),
});

export function buildRejectionValue(kind) {
  const factory = REJECTION_FACTORIES[kind];
  if (factory === undefined) {
    throw new Error(`unknown rejection vector kind: ${kind}`);
  }
  return factory();
}

export const REJECTION_KINDS = Object.freeze(Object.keys(REJECTION_FACTORIES));
