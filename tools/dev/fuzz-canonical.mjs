#!/usr/bin/env node
import { canonicalize } from '../../packages/ast/index.js';
const seeds = [
  {}, { a: 1 }, [], [1, 2, 'three'], { nested: { deep: true } },
  'hello', 42, 0, true, false, null,
  { b: 1, a: 2, c: { z: 1, y: 2 } },
  'e\u0301', 'مرحبا', '🚀',
];
const mutators = [
  (v) => Array.isArray(v) ? [...v, Math.random()] : v,
  (v) => (typeof v === 'object' && v !== null) ? ({ ...v, [Math.random().toString(36)]: Math.random() }) : v,
  () => (Math.random() < 0.5 ? Math.floor(Math.random() * 1e9) : Math.random().toString(36)),
  () => Array.from({ length: Math.floor(Math.random() * 5) }, () => Math.random()),
  () => ({}),
];
let good = 0;
for (let i = 0; i < 2000; i++) {
  let v = seeds[Math.floor(Math.random() * seeds.length)];
  for (let m = 0; m < 3; m++) v = mutators[Math.floor(Math.random() * mutators.length)](v);
  try {
    const c = canonicalize(v);
    const rt = JSON.parse(c);
    const c2 = canonicalize(rt);
    if (c !== c2) { console.error('roundtrip fail', v); process.exit(1); }
    good++;
  } catch (e) {
    if (!e.code || !String(e.code).startsWith('NEXA_E_')) { console.error('unexpected error', e); process.exit(1); }
  }
}
console.log('fuzz: ' + good + ' canonical values round-tripped; invalid inputs rejected cleanly');
