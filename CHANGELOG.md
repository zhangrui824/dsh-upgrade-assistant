# Changelog

## 1.1.0 — 2026-10-30

### 新增
- **传递依赖（全家桶）刷新**：GitHub 来源 bundle（如 dsh-web）行内新增"刷新内含依赖"按钮；
  `/update` 路由支持 `mode: 'transitive'`，解析 bundle 的 npm 依赖清单后按声明范围原地刷新
  （`pnpm update <deps> --config.minimumReleaseAge=0`）。实测 @linxin666/dsh-web-all 0.4.7 → 0.4.12。
- **升级前兼容性预检**：最新版声明 `engines.dsh` 时，用与 DSH 官方一致的 semver 语义
  （`includePrerelease: true`，34 用例对拍 node-semver）判断当前 DSH 是否满足；
  不满足显示"等 DSH 版本"并隐藏升级按钮。
- **行内确认**：npm 直装包的升级改为两段式（升级 → 确认升级到 X / 取消）。
- **失败可解释**：pnpm 失败输出以可折叠详情展示；错误码映射为中文人话
  （超时/版本未动/忙/无新版/包不存在/pnpm 缺失/服务未生效/非同源拒绝）。
- **防降级**：npm `latest` 标签落后于已装版本时拒绝更新（官方包标签滞后的场景）。
- **正式测试套件**：`npm test`（8 组用例：semver 比较与范围求值、信任栅栏、包名白名单、防降级）。
- **README.md / CHANGELOG.md**；`engines.dsh >=0.2.1-rc.2` 兼容性声明。

### 修复
- 信任栅栏拒绝时返回 `403 + JSON` 说明（原来是裸 404，容易被误读成"路由不存在"）。
- `/update` 的方法错误返回 `405` 语义。

## 1.0.0 — 2026-10-29

首个可用版本。

- 插件页新增"升级"标签：已安装插件列表、npm 最新版对比（并发 3、走 profile 镜像源、5 分钟缓存）、
  DSH 版本检测与本体更新检查、版本豁免展示、失败说明卡、自诊断状态条。
- Host 路由：`/host-info`（DSH 版本）、`/latest`（npm 最新版 + engines.dsh）、`/update`（原地 pnpm update）。
- 升级执行：`pnpm update --latest --config.minimumReleaseAge=0`（绕过 24h 发布冷却）+ 更新后版本校验
  （防 pnpm 静默空转谎报成功）+ 单飞锁 + 超时强杀 + 包名白名单。
- 信任栅栏：回环 socket + 回环 Host 头 + 同源标记（与社区 dsh-update 同级）。
- 中英文本地化；原创图标。
