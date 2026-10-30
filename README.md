# 升级助手（dsh-upgrade-assistant / Upgrade Assistant for DeepSeek Harness）

**English**: A DeepSeek Harness (DSH) plugin that adds an **"Upgrades" tab** to the Plugins page —
update checks against npm, DSH-compatibility preflight (`engines.dsh`), and one-click in-place
upgrades that bypass pnpm's 24h release-cooling gate, with every failure explained in plain language.
（中文说明见下。）

一个 DeepSeek Harness（DSH）插件：在插件页新增**「升级」标签页**，把所有插件的更新检查、
兼容性预检和一键升级集中到一处，并把常见升级失败翻译成人话。

```
PM ✓ · zh · 8 bundles · dsh 0.2.1-rc.5        ← 自诊断状态条
┌ Harness (DSH) ── 当前版本 / npm 最新版 [检查 DSH 更新]
├ 已安装插件 (N) ── [检查插件更新]
│   上下文 (dsh-context)  0.77.0 → 0.78.1  [可升级]      engines.dsh: …
│   Claude Code 子智能体  0.2.1-rc.2       [官方] [已是最新]
│   dsh-web 0.4.7                          [非 npm 包，已跳过] [刷新内含依赖]
├ 版本豁免 —— 当前有哪些"跳过 DSH 版本检查"的豁免
└ 升级失败时怎么看 —— 四类常见失败的解读
```

## 安装

从 GitHub 安装（推荐）：

```
dsh plugin --profile <你的profile> add github:zhangrui824/dsh-upgrade-assistant
```

或从本地克隆安装：

```
git clone https://github.com/zhangrui824/dsh-upgrade-assistant.git
dsh plugin --profile <你的profile> add file:/absolute/path/to/dsh-upgrade-assistant
```

或在会话里让智能体执行 `plugin_manager` 的 `install_bundle`，目标为本目录的绝对路径。

## 使用

1. 打开左侧边栏 **插件** → 顶部 **升级** 标签
2. **检查插件更新**：并发对比 npm 最新版（走 profile 配置的镜像源，5 分钟缓存）
3. 绿色"可升级" → 点 **升级**（行内确认后执行）；黄色"等 DSH 版本" → 先升级 DSH
4. **检查 DSH 更新**：对比 DSH 本体与 npm 最新版

### 更新原理（重要）

- **npm 直装的插件**：原地执行 `pnpm update --latest --config.minimumReleaseAge=0 <包名>`
  ——`minimumReleaseAge=0` 会绕过 pnpm 的 24 小时发布冷却期（即"版本太近不让升级"的根源），
  这是**用户主动点击**才触发的行为。
- **传递依赖**（GitHub 来源 bundle 内含的 npm 依赖，如 dsh-web 拉入的 @linxin666 全家桶）：
  `pnpm update --latest` 对传递依赖无效（静默空转），本插件使用**范围内刷新**
  `pnpm update <依赖...> --config.minimumReleaseAge=0`（按父包声明的语义化范围移动）。
- **升级后校验**：重读 `node_modules` 里的实际版本，pnpm 退出码为 0 但版本未动会明确报
  "stale" 而不是谎报成功。
- **防降级**：npm 的 `latest` 标签落后于已装版本时（官方 @deepseek-ai 包常见）直接拒绝更新。

## 安全模型

自定义 Web 路由不走 DSH 网页的 Cookie 认证，因此本插件的三条路由自带信任栅栏
（与社区 dsh-update 同级的实现）：

- 仅接受**本机回环地址**的连接（127/8、::1），且 `Host` 头必须是回环主机名
- 浏览器请求必须是**同源**（`Origin` 匹配 + `sec-fetch-site ≠ cross-site`）
- `X-Forwarded-For` 一律不信任；被拒请求返回 `403 + JSON` 说明
- 升级路由额外要求：POST、包名白名单正则（防注入/防穿越）、4KB 请求上限、
  **单飞锁**（同时只允许一个 pnpm 操作）、10 分钟超时强杀（Windows taskkill / Unix 进程组）

## 兼容性预检

每个可升级包的最新版如果声明了 `engines.dsh`，会在**升级前**用语义化范围求值器
（与 DSH 官方同一套 node-semver 语义，`includePrerelease: true`，34 个用例对拍原库通过）
判断当前 DSH 是否满足。不满足的包显示"等 DSH 版本"并隐藏升级按钮——避免必败的升级尝试。
无法解析的范围语法**不会拦截**（显示要求原文，安装时由 DSH 官方校验兜底）。

## 常见问题

**升级按钮点了报"升级服务尚未生效"？**
Host 半端的代码修改需要重启 Harness 一次才生效（Client 端改动刷新页面即可）。

**为什么有的包显示"非 npm 包，已跳过"？**
该包从 GitHub / 本地路径安装，npm 上没有可比对的版本。GitHub 来源的行会提供
"刷新内含依赖"按钮，用于更新它拉入的 npm 全家桶。

**"版本豁免"是什么？**
跳过 DSH 版本兼容检查的许可记录。升级 DSH 后可在对应插件详情页撤销。

**和 dsh-update 插件什么关系？**
dsh-update 按作者家族（@linxin666/*）更新全家桶；本插件覆盖 npm 直装 bundle 的全局检查与升级。
两者的更新命令在传递依赖场景有差异（`--latest` 只作用于直接依赖），本插件已按两种模式区分处理。

## 开发与测试

```
npm test        # 运行测试（版本比较 / 范围求值 / 信任栅栏 / 包名校验 / 防降级）
node --check index.js && node --check client.js   # 语法检查
```

测试通过源码切片加载纯函数执行（与插件运行的是同一段代码）。Host 半端修改需重启
Harness 生效；Client 半端修改刷新页面即可。

### 文件结构

```
├── index.js          # Host 半端：3 条路由 + 版本检测 + 信任栅栏 + pnpm 更新执行器
├── client.js         # Client 半端：plugins.tab 的"升级"标签页
├── cordis.patch.yml  # Loader 行声明
├── locale/           # 插件元数据（Plugin Manager 列表展示）
├── test/run-tests.mjs
└── STATUS.md         # 详细开发记录与踩坑笔记（排障先看它）
```

## 已知边界

- DSH 版本检测依赖 `DSH_CLIENT_VERSION` 环境变量或入口脚本向上查找 `@deepseek-ai/dsh` 清单，
  两者都不可用时显示"未知"（不影响其他功能）。
- registry 默认 npmjs，优先使用 profile 配置的 `resolved` 源；私有源需要认证时查询会失败并显示原因。
- 本插件自身从本地路径安装时无法自更新（发布到 npm 后可用它自己的"升级"按钮自升级）。

## License

MIT
