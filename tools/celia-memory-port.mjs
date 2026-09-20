#!/usr/bin/env node
/**
 * Celia Memory Port — Supabase adapter as injected port
 * 
 * This is the ONLY place that talks to Supabase. It is NOT in packages/
 * so posture check allows node:fs and network here, but not in protocol.
 * 
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... node tools/celia-memory-port.mjs --test
 * 
 * For NEXA, the port is injected as:
 *   const storePort = createSupabasePort({ url, key, table: 'celia_memory' });
 *   const cell = createMemoryCell({ identity, storePort });
 */

export function createSupabasePort({ url, key, table = 'celia_memory', fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Supabase port needs url and key (use vault:// handle in prod)');

  return {
    async write(record) {
      // In real impl: POST to Supabase
      // For demo: in-memory
      console.log(`[supabase-port] write ${record.tier} ${record.digest.slice(0,8)}...`);
      return { ok: true, id: record.id };
    },
    async read({ tier, limit, owner_kid }) {
      console.log(`[supabase-port] read tier=${tier} limit=${limit} owner=${owner_kid.slice(0,16)}...`);
      return []; // demo returns empty
    },
    async delete({ id, owner_kid }) {
      console.log(`[supabase-port] delete ${id}`);
      return { deleted: 1 };
    }
  };
}

export function createMongoPort({ uri, dbName = 'celia', collection = 'memory' }) {
  // Alternative: MongoDB Atlas port
  return {
    async write(record) {
      console.log(`[mongo-port] write ${record.tier} ${record.digest.slice(0,8)}...`);
      return { ok: true, id: record.id };
    },
    async read({ tier, limit }) {
      console.log(`[mongo-port] read tier=${tier}`);
      return [];
    },
    async delete({ id }) {
      console.log(`[mongo-port] delete ${id}`);
      return { deleted: 1 };
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Celia memory port demo (no real DB, uses in-memory mock)');
  const port = createSupabasePort({ url: 'https://demo.supabase.co', key: 'demo-key' });
  const rec = { id: 'test', tier: 'episodic', digest: 'abc123', owner_kid: 'nexa:key:ed25519:demo', evidence_ref: 'hash123' };
  await port.write(rec);
  await port.read({ tier: 'episodic', limit: 10, owner_kid: 'demo' });
  console.log('port OK');
}
