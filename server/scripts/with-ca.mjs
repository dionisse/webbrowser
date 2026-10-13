#!/usr/bin/env node
/**
 * TLS trust bootstrap.
 *
 * Node ships its own CA bundle, so in environments that terminate TLS with a
 * local root (corporate proxies, CI sandboxes, the Nimbus preview runtime)
 * outbound `fetch` fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE even though curl
 * works fine. The cloud browsing engine depends on outbound TLS, so we point
 * Node at the system trust store before it starts.
 *
 * `NODE_EXTRA_CA_CERTS` is read once at process start, hence this wrapper.
 * It is a no-op when a CA is already configured or no bundle is present.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CANDIDATES = [
  process.env.NIMBUS_CA_BUNDLE,
  '/etc/ssl/certs/ca-certificates.crt', // Debian / Ubuntu
  '/etc/pki/tls/certs/ca-bundle.crt', // RHEL / Fedora
  '/etc/ssl/ca-bundle.pem', // openSUSE
  '/usr/local/share/ca-certificates/e2b-ca.crt', // sandbox runtime
].filter(Boolean);

const bundle = CANDIDATES.find((p) => existsSync(p));

const here = dirname(fileURLToPath(import.meta.url));

const candidatesFor = (name) => [
  resolve(here, `../node_modules/.bin/${name}`),
  resolve(here, `../../node_modules/.bin/${name}`),
];

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) {
  console.error('usage: with-ca.mjs <command> [args…]');
  process.exit(2);
}

const resolved = candidatesFor(command).find((p) => existsSync(p)) ?? command;

const env = { ...process.env };
if (bundle && !env.NODE_EXTRA_CA_CERTS) {
  env.NODE_EXTRA_CA_CERTS = resolve(bundle);
  process.stderr.write(`[nimbus] trusting system CA bundle: ${env.NODE_EXTRA_CA_CERTS}\n`);
}

const child = spawn(resolved, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
