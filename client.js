/**
 * Client half of the Upgrade Assistant bundle.
 *
 * Adds an "Upgrades" tab to the Plugins page (`plugins.tab`). The tab lists
 * installed bundles, checks npm for newer versions through the existing
 * `remote.pluginManager` namespace, starts upgrades through the page's own
 * install dialog (`install` prop), and explains the usual failure classes:
 * engines.dsh blockers, pnpm minimumReleaseAge, pending build scripts, and
 * restart-required outcomes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-upgrade-assistant',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'upgrade-assistant';
    const ROUTE_HOST_INFO = '/upgrade-assistant/host-info';
    const ROUTE_LATEST = '/upgrade-assistant/latest';
    const ROUTE_UPDATE = '/upgrade-assistant/update';
    const ROUTE_FAMILY = '/upgrade-assistant/family';
    const CHECK_CONCURRENCY = 3;
    const REFRESH_DELAYS_MS = [10000, 25000, 45000];
    const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

    const DICTS = {
      en: {
        tab: 'Upgrades',
        title: 'Upgrade Assistant',
        subtitle: 'One place to update plugins and check version compatibility.',
        refresh: 'Refresh',
        dshCard: 'Harness (DSH)',
        dshVersion: 'Current version',
        dshLatest: 'Latest on npm',
        dshCheckError: 'Could not read the npm registry',
        dshRequiredBadge: 'Needs newer DSH',
        dshRequiredDetail: 'Requires engines.dsh {v} (current {c}) — upgrade DSH first, then re-check.',
        enginesNote: 'engines.dsh: {v}',
        checkDsh: 'Check DSH updates',
        dshNewer: 'DSH {v} is available.',
        upgradeDshHint: 'Upgrade DSH itself the way you installed it (npm/npx or the desktop app), then restart sessions.',
        bundlesTitle: 'Installed plugins ({n})',
        checkAll: 'Check plugin updates',
        checking: 'Checking…',
        updating: 'Updating…',
        updateOk: 'Updated: {from} → {to}',
        familyRefresh: 'Refresh bundled family',
        familyOk: 'Bundled family dependencies refreshed',
        familyUnchanged: 'Bundled family dependencies are already current',
        upToDate: 'Up to date',
        upgradable: 'Upgrade available',
        upgradeTo: 'Upgrade',
        confirmUpgrade: 'Confirm upgrade to',
        cancel: 'Cancel',
        viewOutput: 'pnpm output',
        errTimeout: 'Update timed out (10 min); the process was terminated.',
        errStale: 'pnpm finished but the installed version did not change.',
        errBusy: 'Another update is already running — wait for it to finish.',
        errNoNewer: 'No newer version to install.',
        errNotFound: 'The package was not found on npm.',
        errPnpmMissing: 'pnpm was not found (tried pnpm, corepack, npx).',
        errNoFamily: 'This bundle declares no npm dependencies — nothing to refresh.',
        errForbidden: 'Refused: only same-origin requests from this machine may update.',
        errNeedRestart: 'The update service is not live yet — restart the Harness once, then retry.',
        unknown: 'Unknown',
        notOnNpm: 'Not an npm package — skipped',
        skipHintGithub: 'GitHub source: no npm version to compare. This bundle and its bundled family packages are checked by the dsh-update plugin ("有更新" in the sidebar).',
        checkFailed: 'Check failed',
        official: 'Official',
        openDetail: 'Open details',
        npmVersion: 'npm: {v}',
        remoteMissing: 'The plugin-manager remote namespace is not mounted in this client; the tab cannot read plugin data.',
        loadFailed: 'Could not load installed bundles: {e}',
        loading: 'Loading installed plugins…',
        empty: 'No installed plugins found.',
        exemptions: 'Version exemptions',
        exemptionsEmpty: 'No version exemptions.',
        exemptionsHint: 'Exemptions allow installing a package version the running DSH would reject. Remove them after upgrading DSH (Plugins page → bundle details).',
        helpTitle: 'When an upgrade fails',
        helpIncompatible: '"Incompatible version" — the plugin requires a newer DSH (engines.dsh). Upgrade DSH first, then retry.',
        helpReleaseAge: '"Version too close / no matching version" — pnpm\'s minimumReleaseAge defers brand-new releases. Retry later or pin the previous version.',
        helpBuilds: '"Pending build scripts" — approve the listed packages\' install scripts, then retry.',
        helpRestart: '"Restart required" — the change applies at the next harness start; the dialog says why.',
      },
      zh: {
        tab: '升级',
        title: '升级助手',
        subtitle: '在这里集中更新插件、检查 DSH 版本兼容。',
        refresh: '刷新',
        dshCard: 'Harness（DSH）',
        dshVersion: '当前版本',
        dshLatest: 'npm 最新版',
        dshCheckError: '无法读取 npm registry',
        dshRequiredBadge: '等 DSH 版本',
        dshRequiredDetail: '要求 engines.dsh {v}（当前 {c}）——先升级 DSH，再回来升级该插件。',
        enginesNote: 'engines.dsh：{v}',
        checkDsh: '检查 DSH 更新',
        dshNewer: 'DSH 有新版本 {v} 可用。',
        upgradeDshHint: '按你安装 DSH 的方式升级本体（npm/npx 或桌面应用），然后重启会话。',
        bundlesTitle: '已安装插件（{n}）',
        checkAll: '检查插件更新',
        checking: '检查中…',
        updating: '更新中…',
        updateOk: '已升级：{from} → {to}',
        familyRefresh: '刷新内含依赖',
        familyOk: '内含依赖已刷新',
        familyUnchanged: '内含依赖已是最新',
        upToDate: '已是最新',
        upgradable: '可升级',
        upgradeTo: '升级',
        confirmUpgrade: '确认升级到',
        cancel: '取消',
        viewOutput: '查看 pnpm 输出',
        errTimeout: '升级超时（10 分钟），进程已终止。',
        errStale: 'pnpm 执行成功但版本未变化，稍后重试。',
        errBusy: '已有升级在进行中，请等它完成。',
        errNoNewer: '没有更新的版本可安装。',
        errNotFound: 'npm 上找不到该包。',
        errPnpmMissing: '未找到 pnpm（已尝试 pnpm / corepack / npx）。',
        errNoFamily: '该包没有声明任何 npm 内含依赖，无需刷新。',
        errForbidden: '已拒绝：仅允许本机同源请求执行升级。',
        errNeedRestart: '升级服务尚未生效——请重启一次 Harness 后重试。',
        unknown: '未知',
        notOnNpm: '非 npm 包，已跳过',
        skipHintGithub: 'GitHub 来源：npm 上没有版本可比对；此包及其内含的全家桶由 dsh-update 插件负责更新（侧边栏底部「有更新」入口）。',
        checkFailed: '检查失败',
        official: '官方',
        openDetail: '查看详情',
        npmVersion: 'npm：{v}',
        remoteMissing: '客户端未挂载 plugin-manager 远程命名空间，无法读取插件数据。',
        loadFailed: '读取已安装插件失败：{e}',
        loading: '正在读取已安装插件…',
        empty: '没有找到已安装的插件。',
        exemptions: '版本豁免',
        exemptionsEmpty: '没有版本豁免。',
        exemptionsHint: '版本豁免允许安装当前 DSH 本会拒绝的包版本；升级 DSH 后可在插件详情页撤销。',
        helpTitle: '升级失败时怎么看',
        helpIncompatible: '“版本不满足（incompatible-version）”：插件要求更新的 DSH（engines.dsh）。先升级 DSH 再重试。',
        helpReleaseAge: '“版本太近 / 找不到匹配版本”：pnpm 的 minimumReleaseAge 会推迟刚发布的版本，稍后重试或改用上一个版本。',
        helpBuilds: '“待批准构建脚本”：先批准列表中包的安装脚本，再重试。',
        helpRestart: '“需要重启”：变更将在下次启动 Harness 时生效，对话框会说明原因。',
      },
    };

    const CSS = `
.dsw-ua{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:12px;padding:4px 0 24px}
.dsw-ua button{font:inherit}
.dsw-ua-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsw-ua-title{margin:0;font-size:16px;font-weight:600}
.dsw-ua-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dsw-ua-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px}
.dsw-ua-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.dsw-ua-cardTitle{font-size:13px;font-weight:600}
.dsw-ua-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.dsw-ua-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsw-ua-btn:disabled{opacity:.55;cursor:default}
.dsw-ua-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dsw-ua-btnPrimary:hover:not(:disabled){color:#fff;opacity:.92}
.dsw-ua-btnSm{padding:3px 8px;font-size:12px}
.dsw-ua-kv{display:flex;gap:8px;align-items:baseline;padding:2px 0}
.dsw-ua-kvLabel{color:var(--dsw-alias-label-secondary);min-width:96px;flex:none}
.dsw-ua-kvValue{font-variant-numeric:tabular-nums;word-break:break-all}
.dsw-ua-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.dsw-ua-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.dsw-ua-row:first-child{border-top:0}
.dsw-ua-rowMain{flex:1 1 260px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dsw-ua-name{background:none;border:0;padding:0;color:var(--dsw-alias-label-primary);font-weight:500;cursor:pointer;font-size:13px}
.dsw-ua-name:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.dsw-ua-versions{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12.5px;word-break:break-all}
.dsw-ua-tag{font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 6px;line-height:16px;flex:none}
.dsw-ua-badge{font-size:11px;border-radius:999px;padding:1px 8px;line-height:16px;border:1px solid transparent;flex:none}
.dsw-ua-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsw-ua-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsw-ua-badge-idle{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1)}
.dsw-ua-reason{flex-basis:100%;color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-word}
.dsw-ua-note{font-size:12.5px;margin-top:6px}
.dsw-ua-noteOk{color:var(--dsw-alias-state-success-primary)}
.dsw-ua-empty{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:12.5px}
.dsw-ua-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:8px 0 0}
.dsw-ua-helpList{margin:6px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12.5px;display:flex;flex-direction:column;gap:4px}
.dsw-ua-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.dsw-ua-diag{color:var(--dsw-alias-label-secondary);font-size:11px;margin:-6px 0 0}
.dsw-ua-error{color:var(--dsw-alias-state-error-primary);font-size:12.5px;margin:4px 0 0}
.dsw-ua-out{margin:6px 0 0;font-size:12px}
.dsw-ua-out summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsw-ua-pre{margin:6px 0 0;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
`;

    // ---- version comparison (semver subset: X.Y.Z[-pre]) -------------------

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

    function compareVersions(a, b) {
      const pa = parseVersion(a);
      const pb = parseVersion(b);
      if (!pa || !pb) return 0;
      for (let i = 0; i < 3; i += 1) {
        if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
      }
      return comparePre(pa.pre, pb.pre);
    }

    function isNewer(latest, current) {
      if (latest == null || current == null) return false;
      return compareVersions(latest, current) > 0;
    }

    // ---- engines.dsh range check (semver subset, prereleases included) -----

    function parseLooseVersion(value) {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === '*' || trimmed === 'x' || trimmed === 'X') return { nums: [0, 0, 0], pre: null, partial: [false, false, false] };
      const m = /^v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(trimmed);
      if (!m) return null;
      const parts = [m[1], m[2], m[3]];
      const nums = [];
      const partial = [];
      for (let i = 0; i < 3; i += 1) {
        const part = parts[i];
        if (part === undefined || part === 'x' || part === 'X' || part === '*') {
          // Missing lower parts imply wildcard upper parts (1.2 == 1.2.x).
          for (let j = i; j < 3; j += 1) { nums[j] = 0; partial[j] = true; }
          break;
        }
        nums[i] = Number(part);
        partial[i] = false;
      }
      return { nums, pre: m[4] || null, partial };
    }

    function bumpUpperBound(parsed, level) {
      // level 0 → next major, 1 → next minor, 2 → next patch
      const nums = [parsed.nums[0], parsed.nums[1], parsed.nums[2]];
      nums[level] += 1;
      for (let i = level + 1; i < 3; i += 1) nums[i] = 0;
      return { nums, pre: null, partial: [false, false, false] };
    }

    function compareParsed(a, b) {
      for (let i = 0; i < 3; i += 1) {
        if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
      }
      return comparePre(a.pre, b.pre);
    }

    /**
     * One comparator as a [min, max) interval; null bounds are open.
     * Returns null when the syntax is unknown (the caller then does not block).
     * Upper bounds follow node-semver: ^1.2 → <2.0.0, ^0.2 → <0.3.0,
     * ^0.0 → <0.1.0, ^0.0.3 → <0.0.4; ~1.2 → <1.3.0; ~1 → <2.0.0.
     */
    function comparatorInterval(comparator) {
      const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
      if (!m) return null;
      const op = m[1] ?? '=';
      const parsed = parseLooseVersion(m[2]);
      if (!parsed) return null;
      if (op === '>' || op === '>=' || op === '<' || op === '<=') {
        if (parsed.partial[0]) return { min: null, max: null };
        const zeroed = { nums: parsed.nums.slice(), pre: parsed.pre, partial: [false, false, false] };
        if (op === '>') return { min: zeroed, max: null, minInc: false };
        if (op === '>=') return { min: zeroed, max: null, minInc: true };
        if (op === '<') return { max: zeroed, maxInc: false };
        return { max: zeroed, maxInc: true };
      }
      if (op === '^') {
        // node-semver caret: the upper bound is decided by the leftmost
        // significant specified part, whether or not lower parts are wildcards.
        let level;
        if (parsed.nums[0] > 0 || parsed.partial[1]) level = 0;
        else if (parsed.nums[1] > 0 || parsed.partial[2]) level = 1;
        else level = 2;
        return { min: parsed, max: bumpUpperBound(parsed, level), minInc: true, maxInc: false };
      }
      if (op === '~') {
        const level = parsed.partial[1] ? 0 : 1;
        return { min: parsed, max: bumpUpperBound(parsed, level), minInc: true, maxInc: false };
      }
      if (parsed.partial.some(Boolean)) {
        // Wildcard equality: 1.2 → >=1.2.0 <1.3.0, 1.x → >=1.0.0 <2.0.0.
        const firstWildcard = parsed.partial.findIndex(Boolean);
        if (firstWildcard === 0) return { min: null, max: null };
        const min = { nums: parsed.nums.slice(), pre: null, partial: [false, false, false] };
        const max = bumpUpperBound(min, firstWildcard - 1);
        return { min, max, minInc: true, maxInc: false };
      }
      if (op === '=') return { min: parsed, max: parsed, minInc: true, maxInc: true };
      return null;
    }

    function satisfiesInterval(parsed, interval) {
      if (interval.min) {
        const cmp = compareParsed(parsed, interval.min);
        if (cmp < 0 || (cmp === 0 && !interval.minInc)) return false;
      }
      if (interval.max) {
        const cmp = compareParsed(parsed, interval.max);
        if (cmp > 0 || (cmp === 0 && !interval.maxInc)) return false;
      }
      return true;
    }

    function satisfiesAlt(parsed, alt) {
      const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt);
      if (hyphen) {
        const lo = parseLooseVersion(hyphen[1]);
        const hi = parseLooseVersion(hyphen[2]);
        if (!lo || !hi) return true;
        return compareParsed(parsed, lo) >= 0 && compareParsed(parsed, hi) <= 0;
      }
      const comparators = alt.split(/\s+/).filter(Boolean);
      if (comparators.length === 0) return true;
      return comparators.every((comparator) => {
        const interval = comparatorInterval(comparator);
        if (!interval) return true; // unknown syntax: never block
        return satisfiesInterval(parsed, interval);
      });
    }

    /**
     * Approximate semver.satisfies(version, range, { includePrerelease: true }).
     * Unknown syntaxes answer true so the tab never blocks on a parse miss;
     * the real install remains the authority.
     */
    function satisfiesRange(version, range) {
      const parsed = parseVersion(version);
      if (!parsed) return true;
      if (typeof range !== 'string' || range.trim() === '' || range.trim() === '*') return true;
      return range.trim().split('||').some((alt) => satisfiesAlt(parsed, alt.trim()));
    }

    /**
     * Unwrap a remote invocation result. Direct client-api calls resolve to
     * `{ ok: true, value }` on success and `{ ok: false, error }` on failure;
     * older faces may hand back the bare value, so both shapes are accepted.
     */
    async function unwrapRemote(promise) {
      const result = await promise;
      if (result !== null && typeof result === 'object' && 'ok' in result) {
        if (result.ok) return result.value;
        const error = result.error;
        throw new Error(typeof error?.message === 'string' && error.message !== '' ? error.message : JSON.stringify(error));
      }
      return result;
    }

    // ---- locale ------------------------------------------------------------

    function activeLocaleId(ctx) {
      let snapshot;
      try {
        snapshot = ctx?.locale?.getLocale?.() ?? ctx?.locale?.getSnapshot?.();
      } catch {
        snapshot = undefined;
      }
      const id = snapshot && (snapshot.active ?? snapshot.locale ?? snapshot.id);
      return typeof id === 'string' && id !== '' ? id.toLowerCase().split('-')[0] : 'en';
    }

    function makeT(ctx) {
      return (key, params) => {
        let text;
        try {
          const bind = ctx?.locale?.bind?.(NS);
          if (typeof bind === 'function') text = bind(key);
        } catch {
          text = undefined;
        }
        if (typeof text !== 'string' || text === '' || text === key) {
          const dict = DICTS[activeLocaleId(ctx)] ?? DICTS.en;
          text = dict[key] ?? DICTS.en[key] ?? key;
        }
        if (params && typeof text === 'string') {
          for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value));
          }
        }
        return text;
      };
    }

    function pickText(value, locale) {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        if (typeof value[locale] === 'string') return value[locale];
        if (typeof value.en === 'string') return value.en;
        for (const candidate of Object.values(value)) {
          if (typeof candidate === 'string') return candidate;
        }
      }
      return undefined;
    }

    // ---- component ---------------------------------------------------------

    function BundleRow(props) {
      const { bundle, check, officialLabel, openDetailLabel, upgradeLabel, confirmLabel, cancelLabel, familyLabel, onOpen, onUpgrade, onUpgradeConfirm, onUpgradeCancel, onFamilyRefresh, versionsText, t } = props;
      const displayName = props.displayName;
      const status = props.status;
      const children = [
        h('div', { key: 'main', className: 'dsw-ua-rowMain' },
          h('button', {
            key: 'name',
            type: 'button',
            className: 'dsw-ua-name',
            title: openDetailLabel,
            onClick: onOpen,
          }, displayName),
          h('span', { key: 'ver', className: 'dsw-ua-versions' }, versionsText),
          bundle.official ? h('span', { key: 'tag', className: 'dsw-ua-tag' }, officialLabel) : null,
          status ? h('span', { key: 'badge', className: `dsw-ua-badge dsw-ua-badge-${status.cls}` }, status.text) : null,
          status && status.reason ? h('div', { key: 'reason', className: 'dsw-ua-reason' }, status.reason) : null,
        ),
      ];
      if (status && status.cls === 'ok') {
        if (props.confirmActive === true) {
          children.push(
            h('button', {
              key: 'confirm',
              type: 'button',
              className: 'dsw-ua-btn dsw-ua-btnPrimary dsw-ua-btnSm',
              onClick: onUpgradeConfirm,
            }, `${confirmLabel} ${check?.latest ?? ''}`.trim()),
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'dsw-ua-btn dsw-ua-btnSm',
              onClick: onUpgradeCancel,
            }, cancelLabel),
          );
        } else {
          children.push(h('button', {
            key: 'upgrade',
            type: 'button',
            className: 'dsw-ua-btn dsw-ua-btnPrimary dsw-ua-btnSm',
            onClick: onUpgrade,
          }, upgradeLabel));
        }
      }
      if (status && status.familyRefreshable) {
        children.push(h('button', {
          key: 'family',
          type: 'button',
          className: 'dsw-ua-btn dsw-ua-btnSm',
          disabled: props.familyBusy === true,
          onClick: onFamilyRefresh,
        }, props.familyBusy === true ? (typeof t === 'function' ? t('updating') : '…') : familyLabel));
      }
      return h('li', { className: 'dsw-ua-row' }, children);
    }

    function UpgradeAssistant(props) {
      const { install, openPackage, api, t, hostCtx } = props;
      if (typeof t !== 'function' || !api) {
        // The slot face was not built as expected — show why instead of a blank
        // panel (a thrown render would be swallowed by the slot error boundary).
        return h('div', { className: 'dsw-ua dsw-ua-diag' },
          h('style', { key: 'css' }, CSS),
          h('p', { className: 'dsw-ua-error' },
            `upgrade-assistant: injected face incomplete (t=${typeof t}, api=${api ? 'object' : 'missing'})`,
          ),
        );
      }

      const [, forceRender] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => {
        let dispose;
        try {
          dispose = hostCtx?.locale?.subscribe?.(forceRender);
        } catch {
          dispose = undefined;
        }
        return typeof dispose === 'function' ? dispose : undefined;
      }, [hostCtx]);

      const [bundles, setBundles] = React.useState(null);
      const [loadError, setLoadError] = React.useState(null);
      const [checks, setChecks] = React.useState({});
      const [checkingAll, setCheckingAll] = React.useState(false);
      const [dsh, setDsh] = React.useState({ current: null, latest: null, checking: false, error: null, fetchStatus: null });
      const [exemptions, setExemptions] = React.useState(null);
      const [registryBase, setRegistryBase] = React.useState(null);
      const [updatingName, setUpdatingName] = React.useState(null);
      const [updateResult, setUpdateResult] = React.useState(null);
      const [confirmName, setConfirmName] = React.useState(null);
      const timersRef = React.useRef([]);

      const localeId = activeLocaleId(hostCtx);

      const load = React.useCallback(async () => {
        if (!api?.pm) {
          setLoadError(null);
          setBundles([]);
          return;
        }
        try {
          const list = await unwrapRemote(api.pm.listBundles());
          setBundles((Array.isArray(list) ? list : []).filter((b) => b && b.installed && typeof b.name === 'string' && b.name !== ''));
          setLoadError(null);
        } catch (error) {
          setLoadError(String(error?.message ?? error));
        }
        try {
          const report = await unwrapRemote(api.pm.listVersionExemptions());
          const map = report?.exemptions ?? {};
          setExemptions(Object.entries(map));
        } catch {
          setExemptions([]);
        }
        try {
          const regs = await unwrapRemote(api.pm.registries());
          const resolved = typeof regs?.resolved === 'string' && regs.resolved !== '' ? regs.resolved
            : typeof regs?.registry === 'string' && regs.registry !== '' ? regs.registry : null;
          setRegistryBase(resolved);
        } catch {
          setRegistryBase(null);
        }
      }, [api]);

      React.useEffect(() => {
        void load();
      }, [load]);

      React.useEffect(() => {
        let alive = true;
        fetch(ROUTE_HOST_INFO, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (alive) setDsh((prev) => ({ ...prev, fetchStatus: response.ok ? 'ok' : `HTTP ${response.status}` }));
            return response.ok ? response.json() : null;
          })
          .then((data) => {
            if (alive && data && typeof data.dshVersion === 'string' && data.dshVersion !== '') {
              setDsh((prev) => ({ ...prev, current: data.dshVersion }));
            }
          })
          .catch((error) => {
            if (alive) setDsh((prev) => ({ ...prev, fetchStatus: String(error?.message ?? error) }));
          });
        return () => { alive = false; };
      }, []);

      React.useEffect(() => () => {
        for (const id of timersRef.current.splice(0)) clearTimeout(id);
      }, []);

      const NON_NPM_SOURCE = /^(?:[a-z][a-z0-9+.-]*:|git\+|git@|\/|\\\\)/i;
      const GITHUB_SOURCE = /^(github:|git\+|git@|https?:\/\/github)/i;

      const isNonNpmSource = React.useCallback((bundle) => {
        const source = bundle?.source;
        return typeof source === 'string' && source !== '' && NON_NPM_SOURCE.test(source);
      }, []);

      const isGithubSource = React.useCallback((bundle) => {
        const source = bundle?.source;
        return typeof source === 'string' && source !== '' && GITHUB_SOURCE.test(source);
      }, []);

      /** How many registry dependencies the installed bundle declares (0 for self-contained ones). */
      const fetchFamilyCount = React.useCallback(async (name) => {
        const response = await fetch(`${ROUTE_FAMILY}?name=${encodeURIComponent(name)}`, { headers: { accept: 'application/json' } });
        const data = await response.json().catch(() => null);
        return data && data.ok === true && Array.isArray(data.deps) ? data.deps.length : 0;
      }, []);

      const fetchLatest = React.useCallback(async (name) => {
        const query = new URLSearchParams({ name });
        const base = registryBase ?? DEFAULT_REGISTRY;
        if (registryBase) query.set('registry', registryBase);
        const response = await fetch(`${ROUTE_LATEST}?${query.toString()}`, { headers: { accept: 'application/json' } });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.ok !== true) {
          const reason = data?.error ?? `HTTP ${response.status}`;
          return { ok: false, error: reason === 'not-found' ? 'not-found' : String(reason) };
        }
        void base;
        return { ok: true, version: data.version ?? null, enginesDsh: data.enginesDsh ?? null };
      }, [registryBase]);

      const checkOne = React.useCallback(async (name, bundle) => {
        if (isNonNpmSource(bundle)) {
          setChecks((prev) => ({ ...prev, [name]: { kind: 'refused', problem: 'not-found' } }));
          if (isGithubSource(bundle) && name !== 'dsh-upgrade-assistant') {
            // Only offer the family refresh to bundles that actually declare
            // registry dependencies — self-contained ones (empty deps) have
            // nothing to refresh and must not grow a dead button.
            const familyCount = await fetchFamilyCount(name);
            if (familyCount > 0) {
              setChecks((prev) => ({ ...prev, [name]: { kind: 'refused', problem: 'not-found', familyCount } }));
            }
          }
          return;
        }
        setChecks((prev) => ({ ...prev, [name]: { kind: 'checking' } }));
        try {
          const result = await fetchLatest(name);
          if (result.ok) {
            setChecks((prev) => ({ ...prev, [name]: { kind: 'ok', latest: result.version, enginesDsh: result.enginesDsh } }));
          } else {
            setChecks((prev) => ({ ...prev, [name]: { kind: 'refused', problem: result.error, reason: result.error } }));
          }
        } catch (error) {
          setChecks((prev) => ({ ...prev, [name]: { kind: 'error', message: String(error?.message ?? error) } }));
        }
      }, [fetchFamilyCount, fetchLatest, isGithubSource, isNonNpmSource]);

      const checkAll = React.useCallback(async () => {
        if (!api?.pm || checkingAll || !bundles?.length) return;
        setCheckingAll(true);
        try {
          const byName = new Map(bundles.map((b) => [b.name, b]));
          const queue = bundles.map((b) => b.name);
          const worker = async () => {
            for (;;) {
              const name = queue.shift();
              if (name === undefined) return;
              await checkOne(name, byName.get(name));
            }
          };
          const workers = [];
          for (let i = 0; i < Math.min(CHECK_CONCURRENCY, queue.length); i += 1) workers.push(worker());
          await Promise.all(workers);
        } finally {
          setCheckingAll(false);
        }
      }, [api, bundles, checkOne, checkingAll]);

      const checkDsh = React.useCallback(async () => {
        if (!api?.pm || dsh.checking) return;
        setDsh((prev) => ({ ...prev, checking: true }));
        try {
          const result = await fetchLatest('@deepseek-ai/dsh');
          if (result.ok) {
            setDsh((prev) => ({ ...prev, checking: false, latest: result.version, error: null }));
          } else {
            setDsh((prev) => ({ ...prev, checking: false, error: result.error ?? t('dshCheckError') }));
          }
        } catch (error) {
          setDsh((prev) => ({ ...prev, checking: false, error: String(error?.message ?? error) }));
        }
      }, [api?.pm, dsh.checking, fetchLatest, t]);

      const scheduleRefreshes = React.useCallback(() => {
        for (const delay of REFRESH_DELAYS_MS) {
          const id = setTimeout(() => { void load(); }, delay);
          timersRef.current.push(id);
        }
      }, [load]);

      const rows = React.useMemo(() => {
        if (!bundles) return [];
        const arr = bundles.slice();
        arr.sort((a, b) => {
          const au = checks[a.name]?.kind === 'ok' && isNewer(checks[a.name].latest, a.version) ? 0 : 1;
          const bu = checks[b.name]?.kind === 'ok' && isNewer(checks[b.name].latest, b.version) ? 0 : 1;
          if (au !== bu) return au - bu;
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return arr;
      }, [bundles, checks]);

      const statusOf = React.useCallback((bundle) => {
        const check = checks[bundle.name];
        if (updatingName === bundle.name) return { cls: 'idle', text: t('updating') };
        if (!check) return null;
        if (check.kind === 'checking') return { cls: 'idle', text: t('checking') };
        if (check.kind === 'ok') {
          if (check.latest == null) return { cls: 'idle', text: t('unknown') };
          if (bundle.version == null) return { cls: 'idle', text: t('npmVersion', { v: check.latest }) };
          if (!isNewer(check.latest, bundle.version)) return { cls: 'idle', text: t('upToDate') };
          // Upgrade available: preflight the engines.dsh requirement of the
          // new version against the running DSH before offering the button.
          if (check.enginesDsh && dsh.current != null && !satisfiesRange(dsh.current, check.enginesDsh)) {
            return {
              cls: 'warn',
              text: t('dshRequiredBadge'),
              reason: t('dshRequiredDetail', { v: check.enginesDsh, c: dsh.current }),
            };
          }
          return {
            cls: 'ok',
            text: t('upgradable'),
            reason: check.enginesDsh ? t('enginesNote', { v: check.enginesDsh }) : null,
          };
        }
        if (check.kind === 'refused') {
          if (check.problem === 'not-found') {
            const source = typeof bundle.source === 'string' ? bundle.source : '';
            const isGithub = /^(github:|git\+|git@|https?:\/\/github)/i.test(source);
            return {
              cls: 'idle',
              text: t('notOnNpm'),
              reason: isGithub ? t('skipHintGithub') : null,
              // The button only appears once the /family probe confirmed the
              // bundle actually declares registry dependencies (check.familyCount).
              familyRefreshable: isGithub && bundle.name !== 'dsh-upgrade-assistant' && check.familyCount > 0,
            };
          }
          return { cls: 'warn', text: t('checkFailed'), reason: check.reason ?? check.problem };
        }
        return { cls: 'warn', text: t('checkFailed'), reason: check.message };
      }, [checks, dsh.current, t, updatingName]);

      const dshNewer = dsh.current != null && dsh.latest != null && isNewer(dsh.latest, dsh.current);

      const describeUpdateError = React.useCallback((data, status) => {
        const code = data?.errorCode;
        if (data?.error === 'forbidden — same-origin loopback only') return t('errForbidden');
        if (status === 404 && (!data || data.error === void 0)) return t('errNeedRestart');
        switch (code) {
          case 'timeout': return t('errTimeout');
          case 'stale': return t('errStale');
          case 'busy': return t('errBusy');
          case 'no-newer': return t('errNoNewer');
          case 'not-found': return t('errNotFound');
          case 'pnpm-missing': return t('errPnpmMissing');
          case 'no-family': return t('errNoFamily');
          default: return data?.error ?? `HTTP ${status}`;
        }
      }, [t]);

      const runUpdate = React.useCallback(async (bundle) => {
        const check = checks[bundle.name];
        if (updatingName || !check || check.kind !== 'ok' || check.latest == null) return;
        if (check.enginesDsh && dsh.current != null && !satisfiesRange(dsh.current, check.enginesDsh)) return;
        setConfirmName(null);
        setUpdatingName(bundle.name);
        setUpdateResult(null);
        try {
          const response = await fetch(ROUTE_UPDATE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ name: bundle.name }),
          });
          const data = await response.json().catch(() => null);
          const moved = data?.ok === true && data?.moved === true;
          setUpdateResult({
            name: bundle.name,
            ok: moved,
            from: data?.from ?? null,
            to: data?.to ?? null,
            error: moved ? null : describeUpdateError(data, response.status),
            output: typeof data?.output === 'string' ? data.output : '',
          });
          if (moved) {
            setChecks((prev) => ({ ...prev, [bundle.name]: { kind: 'ok', latest: data.to, enginesDsh: check.enginesDsh } }));
          }
        } catch (error) {
          setUpdateResult({ name: bundle.name, ok: false, error: String(error?.message ?? error), output: '' });
        } finally {
          setUpdatingName(null);
          scheduleRefreshes();
        }
      }, [checks, dsh.current, describeUpdateError, scheduleRefreshes, updatingName]);

      const runFamilyRefresh = React.useCallback(async (bundle) => {
        if (updatingName) return;
        setUpdatingName(bundle.name);
        setUpdateResult(null);
        try {
          const response = await fetch(ROUTE_UPDATE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ name: bundle.name, mode: 'transitive' }),
          });
          const data = await response.json().catch(() => null);
          const ok = data?.ok === true;
          const changed = Array.isArray(data?.changed) ? data.changed : [];
          setUpdateResult({
            name: bundle.name,
            ok,
            familyMode: true,
            changed,
            error: ok ? null : describeUpdateError(data, response.status),
            output: typeof data?.output === 'string' ? data.output : '',
          });
        } catch (error) {
          setUpdateResult({ name: bundle.name, ok: false, error: String(error?.message ?? error), output: '' });
        } finally {
          setUpdatingName(null);
          scheduleRefreshes();
        }
      }, [describeUpdateError, scheduleRefreshes, updatingName]);

      const requestUpgrade = React.useCallback((bundle) => {
        setConfirmName(bundle.name);
      }, []);

      const cancelUpgrade = React.useCallback(() => {
        setConfirmName(null);
      }, []);

      let children;
      try {
      children = [
        h('style', { key: 'css' }, CSS),
        h('header', { key: 'head', className: 'dsw-ua-head' },
          h('div', { key: 'titles' },
            h('h2', { key: 'title', className: 'dsw-ua-title' }, t('title')),
            h('p', { key: 'sub', className: 'dsw-ua-sub' }, t('subtitle')),
          ),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsw-ua-btn dsw-ua-btnSm',
            onClick: () => { void load(); },
          }, t('refresh')),
        ),
      ];
        children.push(h('div', { key: 'diag', className: 'dsw-ua-diag dsw-ua-mono' },
          `pm ${api?.pm ? '✓' : '✗'} · ${localeId} · ${bundles === null ? '…' : String(bundles.length)} bundles`
            + `${dsh.current ? ` · dsh ${dsh.current}` : ` · dsh?${dsh.fetchStatus ?? '…'}`}`,
        ));

        if (!api?.pm) {
        children.push(h('div', { key: 'remoteMissing', className: 'dsw-ua-card' },
          h('p', { className: 'dsw-ua-error' }, t('remoteMissing')),
        ));
      } else {
        children.push(
          h('section', { key: 'dsh', className: 'dsw-ua-card' },
            h('div', { className: 'dsw-ua-cardHead' },
              h('span', { className: 'dsw-ua-cardTitle' }, t('dshCard')),
              h('button', {
                type: 'button',
                className: 'dsw-ua-btn dsw-ua-btnSm',
                disabled: dsh.checking,
                onClick: () => { void checkDsh(); },
              }, dsh.checking ? t('checking') : t('checkDsh')),
            ),
            h('div', { className: 'dsw-ua-kv' },
              h('span', { className: 'dsw-ua-kvLabel' }, t('dshVersion')),
              h('span', { className: 'dsw-ua-kvValue dsw-ua-mono' }, dsh.current ?? t('unknown')),
            ),
            dsh.latest != null ? h('div', { className: 'dsw-ua-kv' },
              h('span', { className: 'dsw-ua-kvLabel' }, t('dshLatest')),
              h('span', { className: 'dsw-ua-kvValue dsw-ua-mono' }, dsh.latest),
            ) : null,
            dsh.error ? h('p', { className: 'dsw-ua-error' }, `${t('dshCheckError')}: ${dsh.error}`) : null,
            dshNewer ? h('p', { className: 'dsw-ua-note dsw-ua-noteOk' },
              `${t('dshNewer', { v: dsh.latest })} ${t('upgradeDshHint')}`,
            ) : null,
          ),
          h('section', { key: 'bundles', className: 'dsw-ua-card' },
            h('div', { className: 'dsw-ua-cardHead' },
              h('span', { className: 'dsw-ua-cardTitle' }, t('bundlesTitle', { n: rows.length })),
              h('button', {
                type: 'button',
                className: 'dsw-ua-btn dsw-ua-btnSm',
                disabled: checkingAll || rows.length === 0,
                onClick: () => { void checkAll(); },
              }, checkingAll ? t('checking') : t('checkAll')),
            ),
            loadError ? h('p', { className: 'dsw-ua-error' }, t('loadFailed', { e: loadError })) : null,
            updateResult ? (updateResult.ok
              ? h('p', { key: 'updOk', className: 'dsw-ua-note dsw-ua-noteOk' },
                updateResult.familyMode === true
                  ? (Array.isArray(updateResult.changed) && updateResult.changed.length
                    ? `${t('familyOk')} (${updateResult.changed.length})` + (updateResult.changed.length <= 6 ? `: ${updateResult.changed.join(', ')}` : '')
                    : t('familyUnchanged'))
                  : t('updateOk', { from: updateResult.from ?? '?', to: updateResult.to ?? '?' }))
              : h('p', { key: 'updErr', className: 'dsw-ua-error' }, `${t('checkFailed')}: ${updateResult.error}`)) : null,
            updateResult && !updateResult.ok && updateResult.output ? h('details', { key: 'updOut', className: 'dsw-ua-out' },
              h('summary', null, t('viewOutput')),
              h('pre', { className: 'dsw-ua-pre' }, updateResult.output.slice(-3000)),
            ) : null,
            rows.length === 0
              ? h('p', { className: 'dsw-ua-empty' }, bundles === null ? t('loading') : t('empty'))
              : h('ul', { className: 'dsw-ua-list' }, rows.map((bundle) => {
                const check = checks[bundle.name];
                const versionsText = `${bundle.version ?? t('unknown')}${check?.kind === 'ok' && check.latest ? ` → ${check.latest}` : ''}`;
                return h(BundleRow, {
                  key: bundle.name,
                  bundle,
                  check,
                  displayName: pickText(bundle.meta?.title, localeId) ?? bundle.name,
                  status: statusOf(bundle),
                  versionsText,
                  officialLabel: t('official'),
                  openDetailLabel: t('openDetail'),
                  upgradeLabel: t('upgradeTo'),
                  confirmLabel: t('confirmUpgrade'),
                  cancelLabel: t('cancel'),
                  familyLabel: t('familyRefresh'),
                  familyBusy: updatingName === bundle.name,
                  confirmActive: confirmName === bundle.name,
                  t,
                  onOpen: () => { openPackage?.(bundle.name); },
                  onUpgrade: () => { requestUpgrade(bundle); },
                  onUpgradeConfirm: () => { void runUpdate(bundle); },
                  onUpgradeCancel: () => { cancelUpgrade(); },
                  onFamilyRefresh: () => { void runFamilyRefresh(bundle); },
                });
              })),
          ),
          h('section', { key: 'exemptions', className: 'dsw-ua-card' },
            h('div', { className: 'dsw-ua-cardTitle' }, t('exemptions')),
            exemptions == null
              ? h('p', { className: 'dsw-ua-empty' }, t('loading'))
              : exemptions.length === 0
                ? h('p', { className: 'dsw-ua-empty' }, t('exemptionsEmpty'))
                : h('ul', { className: 'dsw-ua-helpList' }, exemptions.map(([pkg, runtimes]) => h('li', { key: pkg },
                  h('span', { className: 'dsw-ua-mono' }, pkg),
                  ` → ${Array.isArray(runtimes) ? runtimes.join(', ') : ''}`,
                ))),
            h('p', { className: 'dsw-ua-hint' }, t('exemptionsHint')),
          ),
        );
      }

      children.push(
        h('section', { key: 'help', className: 'dsw-ua-card' },
          h('div', { className: 'dsw-ua-cardTitle' }, t('helpTitle')),
          h('ul', { className: 'dsw-ua-helpList' },
            h('li', { key: 'incompatible' }, t('helpIncompatible')),
            h('li', { key: 'releaseAge' }, t('helpReleaseAge')),
            h('li', { key: 'builds' }, t('helpBuilds')),
            h('li', { key: 'restart' }, t('helpRestart')),
          ),
        ),
      );

      } catch (error) {
        return h('div', { className: 'dsw-ua' },
          h('style', { key: 'css' }, CSS),
          h('p', { className: 'dsw-ua-error' },
            `upgrade-assistant render error: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      return h('div', { className: 'dsw-ua' }, children);
    }

    // ---- plugin ------------------------------------------------------------

    let pluginCtx;

    /**
     * Resolve the plugin-manager remote namespace. The compiled pages read
     * `ctx.remote.pluginManager`; the namespace is also exposed as the Cordis
     * service `remote.pluginManager`. Both paths are tried defensively so a
     * missing face can never throw during render.
     */
    function resolvePluginManager(ctx) {
      try {
        const viaRemote = ctx.remote?.pluginManager;
        if (viaRemote) return viaRemote;
      } catch {
        // fall through to the service lookup
      }
      try {
        const service = typeof ctx.get === 'function' ? ctx.get('remote.pluginManager') : undefined;
        if (service) return service;
      } catch {
        // unresolved: the tab reports the missing namespace instead of crashing
      }
      return null;
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        pluginCtx = ctx;
        ctx.effect(() => {
          try {
            return ctx.locale?.register?.(NS, { en: DICTS.en, zh: DICTS.zh });
          } catch {
            // a duplicate registration (double load) must not break activation
            return undefined;
          }
        }, 'upgrade-assistant:locale');
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({
          name: 'plugins.tab',
          id: 'upgrade-assistant',
          order: 40,
          label: () => makeT(pluginCtx)('tab'),
          locale: NS,
          inject: () => {
            let t;
            try {
              t = makeT(ctx);
            } catch {
              t = (key) => DICTS.en[key] ?? key;
            }
            return {
              api: { pm: resolvePluginManager(ctx) },
              t,
              hostCtx: ctx,
            };
          },
        }, UpgradeAssistant));
      },
    };
  },
});
