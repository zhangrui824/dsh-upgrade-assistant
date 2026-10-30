/**
 * Shipped test suite for the Upgrade Assistant.
 *
 * The pure logic (version compare, engines.dsh range evaluation, request
 * fence, package-name validation) lives inside the host/client entry files,
 * whose module graphs assume the DSH runtime. The tests therefore extract the
 * function blocks from the sources verbatim and evaluate them — the same code
 * paths the plugin runs, executed standalone. `pnpm test` / `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientSource = readFileSync(path.join(pkgDir, 'client.js'), 'utf8');
const hostSource = readFileSync(path.join(pkgDir, 'index.js'), 'utf8');

/** Evaluate one source slice in this test's scope and return its bindings. */
function loadSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `start marker missing: ${startMarker}`);
  assert.ok(end > start, `end marker missing or misplaced: ${endMarker}`);
  const module = {};
  const slice = source.slice(start, end);
  const names = [
    ...slice.matchAll(/(?:^|\n)\s*(?:async )?function ([A-Za-z0-9_]+)/g).map ? [] : [],
  ];
  const fnNames = [...slice.matchAll(/(?:^|\n)\s*(?:async )?function ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const constNames = [...slice.matchAll(/(?:^|\n)const ([A-Za-z0-9_]+) =/g)].map((m) => m[1]);
  const body = `${slice}\n;Object.assign(exports0, { ${[...new Set([...fnNames, ...constNames])].join(', ')} });`;
  (new Function('exports0', body))(module);
  return module;
}

// ---- client: version compare + range evaluation ----------------------------

function loadClientVersionLogic() {
  const start = clientSource.indexOf('function parseVersion');
  const end = clientSource.indexOf('// ---- locale');
  assert.ok(start >= 0 && end > start);
  const module = {};
  const slice = clientSource.slice(start, end);
  const fnNames = [...slice.matchAll(/(?:^|\n)\s*(?:async )?function ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const constNames = [...slice.matchAll(/(?:^|\n)const ([A-Za-z0-9_]+) =/g)].map((m) => m[1]);
  const body = `${slice}\n;Object.assign(exports0, { ${[...new Set([...fnNames, ...constNames])].join(', ')} });`;
  (new Function('exports0', body))(module);
  return module;
}
const client = loadClientVersionLogic();

test('client: parseVersion accepts semver and prereleases, rejects junk', () => {
  assert.deepEqual(client.parseVersion('1.2.3'), { nums: [1, 2, 3], pre: null });
  assert.deepEqual(client.parseVersion('v0.2.1-rc.2'), { nums: [0, 2, 1], pre: 'rc.2' });
  assert.equal(client.parseVersion('1.2'), null);
  assert.equal(client.parseVersion(''), null);
  assert.equal(client.parseVersion(null), null);
  assert.equal(client.parseVersion('not a version'), null);
});

test('client: compareVersions orders releases and prereleases like node-semver', () => {
  assert.equal(client.compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(client.compareVersions('1.3.0', '1.2.9'), 1);
  assert.equal(client.compareVersions('0.2.1-rc.2', '0.2.1'), -1); // prerelease < release
  assert.equal(client.compareVersions('0.2.1-rc.10', '0.2.1-rc.2'), 1); // numeric identifiers
  assert.equal(client.compareVersions('0.2.1-rc.2', '0.2.1-rc.2'), 0);
  assert.equal(client.compareVersions('garbage', '1.0.0'), 0); // unknown → equal, never blocks
});

test('client: isNewer refuses to compare unknown shapes', () => {
  assert.equal(client.isNewer('1.0.0', null), false);
  assert.equal(client.isNewer(null, '1.0.0'), false);
  assert.equal(client.isNewer('2.0.0', '1.9.9'), true);
  assert.equal(client.isNewer('1.0.0', '2.0.0'), false);
});

test('client: satisfiesRange matches node-semver ground truth (includePrerelease)', () => {
  // Every expectation below was verified against node-semver.satisfies
  // with { includePrerelease: true } — the exact call DSH's compatibility
  // gate makes (dsh-app-boot unmetRequirements).
  const cases = [
    ['0.2.1-rc.2', '>=0.2.1', false],
    ['0.2.1-rc.2', '>=0.2.1-rc.1', true],
    ['0.2.1-rc.2', '~0.2.1', false],
    ['0.2.1-rc.2', '~0.2', true],
    ['0.2.1-rc.2', '^0.2.0', true],
    ['0.2.1-rc.2', '^0.2.1-rc.0', true],
    ['1.4.16', '^1.0.0', true],
    ['1.4.16', '^2.0.0', false],
    ['0.77.0', '>=0.5.0 <1.0.0', true],
    ['0.77.0', '>=1.0.0', false],
    ['1.73.1', '1.x', true],
    ['1.73.1', '2.x', false],
    ['1.0.0', '1.0.0 - 2.0.0', true],
    ['2.5.0', '1.0.0 - 2.0.0', false],
    ['0.4.16', '*', true],
    ['0.4.16', '', true],
    ['0.2.1-rc.2', '>0.2.0', true],
    ['0.2.1-rc.2', '<=0.2.1-rc.2', true],
    ['1.0.0', '^1.0.0 || ^2.0.0', true],
    ['3.0.0', '^1.0.0 || ^2.0.0', false],
    ['1.0.0', '>=0.5.0', true],
    ['0.5.0', '>0.5.0', false],
    ['1.2.3', '^1.2', true],
    ['1.3.0', '^1.2', true],
    ['2.0.0', '^1.2', false],
    ['1.2.9', '~1.2', true],
    ['1.3.0', '~1.2', false],
    ['0.2.1', '^0.2.1-rc.0', true],
    ['0.2.0', '^0.2.1-rc.0', false],
    ['1.99.0', '^1.2', true],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['0.5.0', '^0.x', true],
    ['1.0.0', '^0.x', false],
    ['0.2.1-rc.2', '>=0.2.0-rc.2 || >=0.2.1-rc.2', true],
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(client.satisfiesRange(version, range), expected, `${version} vs ${range}`);
  }
});

// ---- host: fence + name validation + version gate --------------------------

function loadHostLogic() {
  const start = hostSource.indexOf('const ROUTE_HOST_INFO');
  const end = hostSource.indexOf('// ---- route wiring');
  assert.ok(start >= 0 && end > start);
  const module = {};
  const slice = hostSource.slice(start, end);
  const fnNames = [...slice.matchAll(/(?:^|\n)\s*(?:async )?function ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const constNames = [...slice.matchAll(/(?:^|\n)(?:const|let) ([A-Za-z0-9_]+) =/g)].map((m) => m[1]);
  const body = `${slice}\n;Object.assign(exports0, { ${[...new Set([...fnNames, ...constNames])].join(', ')} });`;
  (new Function('exports0', body))(module);
  return module;
}
const host = loadHostLogic();

function fakeReq({ method = 'GET', remote = '127.0.0.1', host = '127.0.0.1:3080', origin, site } = {}) {
  const headers = { host };
  if (origin !== undefined) headers.origin = origin;
  if (site !== undefined) headers['sec-fetch-site'] = site;
  return { method, socket: { remoteAddress: remote }, headers };
}

test('host: fence accepts same-origin loopback browser and tool requests', () => {
  assert.equal(host.isLoopbackRequest(fakeReq()), true); // curl (no origin)
  assert.equal(host.isLoopbackRequest(fakeReq({ origin: 'http://127.0.0.1:3080', site: 'same-origin' })), true); // browser fetch
  assert.equal(host.isLoopbackRequest(fakeReq({ remote: '::1' })), true);
  assert.equal(host.isLoopbackRequest(fakeReq({ remote: '::ffff:127.0.0.1' })), true);
  assert.equal(host.isLoopbackRequest(fakeReq({ host: 'localhost:3080' })), true);
});

test('host: fence rejects remote peers, cross-site posts, spoofed pairs', () => {
  assert.equal(host.isLoopbackRequest(fakeReq({ remote: '192.168.1.7' })), false);
  assert.equal(host.isLoopbackRequest(fakeReq({ origin: 'http://evil.example' })), false);
  assert.equal(host.isLoopbackRequest(fakeReq({ site: 'cross-site' })), false);
  assert.equal(host.isLoopbackRequest(fakeReq({ remote: '127.0.0.1', host: 'lan-name:3080' })), false); // non-loopback Host header
  assert.equal(host.isLoopbackRequest({}), false);
});

test('host: package name gates (registry pattern + shell safety)', () => {
  const ok = (n) => host.PACKAGE_NAME_PATTERN.test(n) && host.SHELL_SAFE_PACKAGE_RE.test(n);
  assert.equal(ok('dshmarket'), true);
  assert.equal(ok('@dsh-market/plugin'), true);
  assert.equal(ok('@linxin666/dsh-web-all'), true);
  assert.equal(ok('../etc/passwd'), false);
  assert.equal(ok('a b'), false);
  assert.equal(ok('x;rm'), false);
  assert.equal(ok('x"y'), false);
  assert.equal(ok(''), false);
});

test('host: version gate refuses downgrades and stale latest tags', () => {
  assert.equal(host.isNewerVersion('0.78.2', '0.77.0'), true);
  assert.equal(host.isNewerVersion('0.0.1-rc.1', '0.2.1-rc.2'), false); // npm latest tag behind installed
  assert.equal(host.isNewerVersion('1.73.5', '1.73.5'), false);
  assert.equal(host.isNewerVersion('garbage', '1.0.0'), false);
});
