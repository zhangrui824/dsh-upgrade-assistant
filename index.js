/**
 * Host half of the Upgrade Assistant bundle.
 *
 * Three read/update HTTP routes, all fenced to same-origin loopback requests:
 * - /upgrade-assistant/host-info — the running DSH version.
 * - /upgrade-assistant/latest    — the newest npm manifest of one package,
 *   including its engines.dsh requirement. `pluginManager.inspect` cannot
 *   answer this: it refuses non-bundle packages and packages that are already
 *   installed, which is exactly the population this tab checks.
 * - /upgrade-assistant/update    — in-place `pnpm update --latest` of ONE
 *   profile-installed package. `pluginManager.installBundle` refuses any spec
 *   naming an installed package ("already-installed"), and `removeBundle` +
 *   install would leave a window without the plugin, so an in-place pnpm
 *   update is the upgrade path. `--config.minimumReleaseAge=0` bypasses the
 *   pnpm 11 supply-chain gate that silently skips same-day releases (the
 *   "版本太近不让升级" failure), and the result is verified against the
 *   actually installed version because pnpm exits 0 even when it moved
 *   nothing.
 *
 * All listing/enabling goes through the existing `remote.pluginManager`
 * namespace; this half adds no other management capability.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROUTE_HOST_INFO = '/upgrade-assistant/host-info';
const ROUTE_LATEST = '/upgrade-assistant/latest';
const ROUTE_UPDATE = '/upgrade-assistant/update';
const ROUTE_FAMILY = '/upgrade-assistant/family';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
const REGISTRY_FETCH_TIMEOUT_MS = 12000;
const PACKAGE_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const SHELL_SAFE_PACKAGE_RE = /^@?[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MIN_RELEASE_AGE_OVERRIDE = '--config.minimumReleaseAge=0';
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_CAP = 16 * 1024;
const WIN_CMD_MISSING_RE = /not recognized as an internal or external command|不是内部或外部命令/i;

const registryCache = new Map();
let updateInFlight = null;

// ---- semver subset (same semantics as the tab: prereleases participate) ----

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(value.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null };
}

function comparePre(a, b) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xNum) {
      return -1;
    } else if (yNum) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function isNewerVersion(latest, current) {
  const pa = parseVersion(latest);
  const pb = parseVersion(current);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
  }
  return comparePre(pa.pre, pb.pre) > 0;
}

// ---- DSH version detection -------------------------------------------------

/**
 * Best-effort version of the running DSH installation.
 *
 * Order: the `DSH_CLIENT_VERSION` environment variable, then the package.json
 * found by walking up from the process entry script until the `dsh` manifest
 * appears. Returns undefined when neither source answers; the tab then shows
 * the version as unknown instead of guessing.
 */
async function detectDshVersion() {
  const fromEnv = process.env.DSH_CLIENT_VERSION;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  const entry = process.argv && process.argv[1];
  if (typeof entry === 'string' && entry !== '') {
    try {
      let dir = path.dirname(path.resolve(entry));
      for (let hop = 0; hop < 12; hop += 1) {
        let manifest;
        try {
          manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
        } catch {
          manifest = undefined;
        }
        if (manifest && typeof manifest === 'object') {
          const name = typeof manifest.name === 'string' ? manifest.name : '';
          if ((name === '@deepseek-ai/dsh' || name === 'dsh') && typeof manifest.version === 'string' && manifest.version !== '') {
            return manifest.version;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // fall through: an unreadable entry path leaves the version unknown
    }
  }
  return undefined;
}

// ---- request fence ---------------------------------------------------------
// Custom web routes bypass the web UI's cookie authentication. Mirror the
// community updater's fence: a loopback socket address AND a loopback Host
// header, plus browser same-origin markers. X-Forwarded-For is never trusted.

function isIPv4Loopback(v4) {
  const parts = v4.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isLoopbackAddress(address) {
  if (address === void 0) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7));
  return isIPv4Loopback(normalized);
}

function isLoopbackRequest(req) {
  if (!isLoopbackAddress(req?.socket?.remoteAddress)) return false;
  const host = req?.headers?.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]' && !isIPv4Loopback(hostUrl.hostname)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/**
 * Guard: only same-origin loopback GETs may pass. Rejections are explicit
 * (403 + JSON) so a blocked request never reads like a missing route — the
 * distinction matters because the fence is a security boundary, and "403
 * refused" and "404 unknown" mean completely different remedies.
 */
function guard(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, { ok: false, error: 'method not allowed' });
    return false;
  }
  if (!isLoopbackRequest(req)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'forbidden — same-origin loopback only' }));
    return false;
  }
  return true;
}

/** Write one JSON body and end the response exactly once. */
function sendJson(res, payload) {
  if (res.writableEnded) return;
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

// ---- npm registry lookup ---------------------------------------------------

function normalizeRegistryBase(registry) {
  if (typeof registry === 'string' && /^https?:\/\//i.test(registry)) return registry.replace(/\/+$/, '');
  return 'https://registry.npmjs.org';
}

async function fetchLatestManifest(name, registry) {
  const base = normalizeRegistryBase(registry);
  const key = `${base}|${name}`;
  const cached = registryCache.get(key);
  if (cached && Date.now() - cached.at < REGISTRY_CACHE_TTL_MS) return cached.data;
  let data;
  try {
    const response = await fetch(`${base}/${name.replace('/', '%2F')}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) {
      data = { ok: false, error: 'not-found' };
    } else if (!response.ok) {
      data = { ok: false, error: `registry HTTP ${response.status}` };
    } else {
      const manifest = await response.json();
      data = {
        ok: true,
        name: typeof manifest?.name === 'string' ? manifest.name : name,
        version: typeof manifest?.version === 'string' ? manifest.version : null,
        enginesDsh: manifest?.engines && typeof manifest.engines.dsh === 'string' && manifest.engines.dsh !== '' ? manifest.engines.dsh : null,
      };
    }
  } catch (error) {
    data = { ok: false, error: String(error?.message ?? error).slice(0, 200) };
  }
  if (data.ok || data.error === 'not-found') registryCache.set(key, { at: Date.now(), data });
  return data;
}

// ---- in-place pnpm update --------------------------------------------------

function readManifestVersion(profileDir, name) {
  try {
    const manifestPath = path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return typeof manifest?.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

function capOutput(output, text) {
  const combined = output + text;
  return combined.length > OUTPUT_CAP ? combined.slice(combined.length - OUTPUT_CAP) : combined;
}

/**
 * Run `pnpm update --latest` for one package inside the profile directory.
 * pnpm first, then corepack pnpm, then npx pnpm; every candidate shares the
 * hard timeout and keeps accumulating output.
 */
function runPnpmUpdate(profileDir, name, mode) {
  return new Promise((resolve) => {
    const platform = process.platform;
    const spawnOptions = {
      cwd: profileDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(platform === 'win32' ? { shell: true } : { detached: true }),
    };
    // `--latest` rewrites the manifest range and only applies to DIRECT
    // dependencies; for transitive packages (e.g. the npm family pulled in by
    // a GitHub-sourced bundle) the in-range `pnpm update <name>` is the only
    // operation that moves them — with --latest pnpm no-ops in milliseconds.
    const updateArgs = mode === 'transitive'
      ? ['update', name, MIN_RELEASE_AGE_OVERRIDE]
      : ['update', '--latest', MIN_RELEASE_AGE_OVERRIDE, name];
    const candidates = [
      { command: 'pnpm', args: updateArgs },
      { command: 'corepack', args: ['pnpm', ...updateArgs] },
      { command: 'npx', args: ['--yes', 'pnpm', ...updateArgs] },
    ];
    let output = '';
    let captureTail = '';
    let currentChild;
    let finished = false;
    let candidateFolded = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const foldCandidate = () => {
      if (candidateFolded) return;
      candidateFolded = true;
      output = capOutput(output, captureTail);
    };
    const timer = setTimeout(() => {
      if (finished) return;
      const pid = currentChild?.pid;
      if (platform === 'win32') {
        if (pid !== void 0 && pid > 0) {
          try {
            spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }).on?.('error', () => {});
          } catch {
            // best-effort kill
          }
        }
      } else {
        try {
          if (pid !== void 0 && pid > 0) process.kill(-pid, 'SIGTERM');
          else currentChild?.kill('SIGTERM');
        } catch {
          try {
            currentChild?.kill('SIGTERM');
          } catch {
            // already gone
          }
        }
      }
      foldCandidate();
      finish({ ok: false, error: 'update timed out; install process killed', errorCode: 'timeout', output });
    }, UPDATE_TIMEOUT_MS);
    const runCandidate = (index) => {
      if (finished) return;
      if (index >= candidates.length) {
        finish({ ok: false, error: 'pnpm not found on PATH (tried pnpm, corepack, npx)', errorCode: 'pnpm-missing', output });
        return;
      }
      const candidate = candidates[index];
      captureTail = '';
      candidateFolded = false;
      let settled = false;
      const once = (fn) => {
        if (settled) return;
        settled = true;
        fn();
      };
      let child;
      try {
        child = spawn(candidate.command, candidate.args, spawnOptions);
      } catch (error) {
        finish({ ok: false, error: String(error?.message ?? error), errorCode: 'spawn-failed', output });
        return;
      }
      currentChild = child;
      child.stdout?.on('data', (chunk) => {
        captureTail = capOutput(captureTail, String(chunk));
      });
      child.stderr?.on('data', (chunk) => {
        captureTail = capOutput(captureTail, String(chunk));
      });
      child.on('error', (error) => {
        once(() => {
          foldCandidate();
          if (error.code === 'ENOENT') runCandidate(index + 1);
          else finish({ ok: false, error: error.message, errorCode: void 0, output });
        });
      });
      child.on('close', (code) => {
        if (finished || settled) return;
        once(() => {
          if (platform === 'win32' && (code === 9009 || (code !== 0 && WIN_CMD_MISSING_RE.test(captureTail)))) {
            foldCandidate();
            runCandidate(index + 1);
            return;
          }
          foldCandidate();
          finish({
            ok: code === 0,
            exitCode: code,
            ...(code === 0 ? {} : { error: `${candidate.command} exited with code ${String(code)}`, errorCode: 'pnpm-failed' }),
            output,
          });
        });
      });
    };
    runCandidate(0);
  });
}

async function runVerifiedUpdate(profileDir, name, mode) {
  const before = readManifestVersion(profileDir, name);
  const result = await runPnpmUpdate(profileDir, name, mode);
  const after = readManifestVersion(profileDir, name);
  if (!result.ok) return { ...result, from: before, to: after, moved: false };
  if (before != null && after != null && after === before) {
    return { ...result, from: before, to: after, moved: false, error: 'pnpm exited 0 but the installed version did not change', errorCode: 'stale' };
  }
  return { ...result, from: before, to: after, moved: true };
}

/** Whether the package is a direct dependency of the profile manifest. */
function isDirectDependency(profileDir, name) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    const deps = manifest?.dependencies;
    return deps !== null && typeof deps === 'object' && Object.hasOwn(deps, name);
  } catch {
    return false;
  }
}

/**
 * The npm dependencies of one installed package (used to refresh the family
 * a GitHub-sourced bundle pulls in — those are transitive and invisible to
 * `pnpm update --latest`).
 */
function npmDependenciesOf(profileDir, name) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'));
    const deps = manifest?.dependencies;
    if (deps === null || typeof deps !== 'object') return [];
    return Object.keys(deps).filter((dep) => PACKAGE_NAME_PATTERN.test(dep) && SHELL_SAFE_PACKAGE_RE.test(dep));
  } catch {
    return [];
  }
}

function handleUpdate(ctx) {
  return (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!isLoopbackRequest(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden — same-origin loopback only' }));
      return;
    }
    let body = '';
    let oversized = false;
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > 4096) {
        oversized = true;
        req.destroy();
      }
    });
    req.on('error', () => {
      sendJson(res, { ok: false, error: 'request aborted' });
    });
    req.on('end', () => {
      if (oversized) {
        sendJson(res, { ok: false, error: 'request too large' });
        return;
      }
      let name = '';
      let mode = 'direct';
      try {
        const parsed = JSON.parse(body || '{}');
        name = typeof parsed.name === 'string' ? parsed.name : '';
        if (parsed.mode === 'transitive') mode = 'transitive';
      } catch {
        sendJson(res, { ok: false, error: 'invalid JSON body' });
        return;
      }
      if (!PACKAGE_NAME_PATTERN.test(name) || !SHELL_SAFE_PACKAGE_RE.test(name)) {
        sendJson(res, { ok: false, error: 'invalid package name' });
        return;
      }
      const profileContext = ctx.get('profileContext');
      const profileDir = profileContext?.dir;
      if (typeof profileDir !== 'string' || profileDir === '') {
        sendJson(res, { ok: false, error: 'profile directory unknown' });
        return;
      }
      if (updateInFlight) {
        sendJson(res, { ok: false, error: 'another update is already running', errorCode: 'busy' });
        return;
      }
      void (async () => {
        if (mode === 'transitive') {
          // In-place refresh of the npm family one bundle pulls in: every
          // registry dependency of the bundle moves inside its declared
          // range (e.g. @linxin666/dsh-web-all 0.4.7 → 0.4.12 under ^0.4.7).
          // The bundle itself stays at its own source version.
          const family = npmDependenciesOf(profileDir, name);
          if (family.length === 0) {
            sendJson(res, { ok: false, error: 'this bundle declares no registry dependencies to refresh', errorCode: 'no-family' });
            return;
          }
          const before = new Map(family.map((dep) => [dep, readManifestVersion(profileDir, dep)]));
          const result = await runPnpmUpdate(profileDir, family.join(' '), 'transitive');
          const changed = family.filter((dep) => {
            const after = readManifestVersion(profileDir, dep);
            return after != null && after !== before.get(dep);
          });
          sendJson(res, {
            ok: result.ok === true,
            name,
            mode,
            family,
            changed,
            moved: result.ok === true,
            ...(result.error === void 0 ? {} : { error: result.error }),
            ...(result.errorCode === void 0 ? {} : { errorCode: result.errorCode }),
            exitCode: result.exitCode ?? null,
            output: result.output ?? '',
          });
          return;
        }
        // Refuse downgrades: only run when the registry latest is newer than
        // the installed version, so a stale npm `latest` tag can never move a
        // bundle backwards.
        const current = readManifestVersion(profileDir, name);
        const latest = await fetchLatestManifest(name, null);
        if (!latest.ok) {
          sendJson(res, { ok: false, error: latest.error === 'not-found' ? 'not-found' : `registry: ${latest.error}`, errorCode: latest.error === 'not-found' ? 'not-found' : 'registry' });
          return;
        }
        if (typeof latest.version !== 'string' || typeof current !== 'string' || !isNewerVersion(latest.version, current)) {
          sendJson(res, { ok: false, error: `no newer version to install (installed ${current ?? 'unknown'}, latest ${latest.version ?? 'unknown'})`, errorCode: 'no-newer' });
          return;
        }
        updateInFlight = runVerifiedUpdate(profileDir, name).finally(() => {
          updateInFlight = null;
        });
        const result = await updateInFlight;
        sendJson(res, {
          ok: result.ok === true && result.moved === true,
          name,
          mode: 'direct',
          from: result.from ?? null,
          to: result.to ?? null,
          moved: result.moved === true,
          ...(result.error === void 0 ? {} : { error: result.error }),
          ...(result.errorCode === void 0 ? {} : { errorCode: result.errorCode }),
          exitCode: result.exitCode ?? null,
          output: result.output ?? '',
        });
      })().catch((error) => {
        sendJson(res, { ok: false, error: String(error?.message ?? error).slice(0, 300) });
      });
    });
  };
}

// ---- route wiring ----------------------------------------------------------

function handleHostInfo(req, res) {
  if (!guard(req, res)) return;
  void (async () => {
    const dshVersion = await detectDshVersion();
    sendJson(res, { dshVersion: dshVersion ?? null });
  })().catch(() => {
    sendJson(res, { dshVersion: null });
  });
}

function handleLatest(req, res) {
  if (!guard(req, res)) return;
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    const name = url.searchParams.get('name') ?? '';
    const registry = url.searchParams.get('registry');
    if (!PACKAGE_NAME_PATTERN.test(name)) {
      sendJson(res, { ok: false, error: 'invalid-name' });
      return;
    }
    fetchLatestManifest(name, registry)
      .then((data) => sendJson(res, data))
      .catch((error) => sendJson(res, { ok: false, error: String(error?.message ?? error).slice(0, 200) }));
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error).slice(0, 200) });
  }
}

/**
 * GET /family?name=<bundle> — the registry dependencies one installed bundle
 * declares (possibly empty: self-contained packages like dsh-popout-sidebar
 * have none, and the tab must not offer a family refresh for them).
 */
function handleFamily(ctx) {
  return (req, res) => {
    if (!guard(req, res)) return;
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.invalid');
      const name = url.searchParams.get('name') ?? '';
      if (!PACKAGE_NAME_PATTERN.test(name) || !SHELL_SAFE_PACKAGE_RE.test(name)) {
        sendJson(res, { ok: false, error: 'invalid package name' });
        return;
      }
      const profileDir = ctx.get('profileContext')?.dir;
      if (typeof profileDir !== 'string' || profileDir === '') {
        sendJson(res, { ok: false, error: 'profile directory unknown' });
        return;
      }
      const deps = npmDependenciesOf(profileDir, name);
      sendJson(res, { ok: true, name, deps, count: deps.length });
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error).slice(0, 200) });
    }
  };
}

export function apply(ctx) {
  // The webServer service may activate after this row (it does after a
  // restart), so register through the injector instead of reading it once.
  // The injector callback receives a child Context carrying the dependency.
  // Deliberately NOT returned: the injected fiber disposes with this plugin's
  // fiber, and a thenable apply return would fail the plugin ("Invalid effect").
  ctx.inject(['webServer'], (injected) => {
    const webServer = injected.get('webServer') ?? injected.webServer;
    if (!webServer || typeof webServer.register !== 'function') return undefined;
    return ctx.effect(() => {
      const routes = [
        webServer.register({ kind: 'exact', path: ROUTE_HOST_INFO, handler: handleHostInfo }),
        webServer.register({ kind: 'exact', path: ROUTE_LATEST, handler: handleLatest }),
        webServer.register({ kind: 'exact', path: ROUTE_FAMILY, handler: handleFamily(ctx) }),
        webServer.register({ kind: 'exact', path: ROUTE_UPDATE, handler: handleUpdate(ctx) }),
      ];
      return () => {
        for (const dispose of routes) {
          try {
            dispose();
          } catch {
            // already disposed with the service
          }
        }
      };
    }, 'upgrade-assistant:routes');
  });
}
