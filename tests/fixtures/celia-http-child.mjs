// Test-only transport bootstrap. The API handlers and filesystem port are real.
// The production server has no injectable listener yet: change only its bind
// address to loopback/port 0, and report readiness over IPC (never parse logs).
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { pathToFileURL } from 'node:url';

assert.equal(typeof process.send, 'function', 'run this fixture through the integration test');
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  Server.prototype.listen = listen;
  const callback = args.findLast(arg => typeof arg === 'function');
  this.once('listening', () => {
    process.send({ type: 'ready', port: this.address().port });
  });
  return listen.call(this, { host: '127.0.0.1', port: 0 }, callback);
};

// If the test runner disappears, do not leave a vulnerable HTTP server behind.
process.on('disconnect', () => process.exit(0));
await import(pathToFileURL(process.argv[2]).href);
