# 项目记忆热索引

非简单任务前快速阅读，只提取相关条目。条目不是当前事实的替代品；路径、配置、版本、测试结果和运行状态必须重新验证。

## 检索与维护

- 先查本索引，再查对应专题文档和代码；只有未命中且需要历史背景时才按关键词检索归档。
- 格式：`ID | 日期 YYYY-MM-DD | 作用域 | 状态 | 结论 | 可复核证据`。ID 在热索引和归档间唯一，迁移时保留；相同事实更新原条目。
- 状态使用 `有效` 或 `待完成`；已失效事实删除或改写，已完成进度删除。
- 达到 120 行或 40 条时，先压缩再追加：删除无效条目，将模块细节迁入专题文档，将仍有历史价值的条目迁入 `memory/archive/YYYY-MM.md`。
- 只保存可跨对话复用的信息，不保存临时日志、猜测、一次性进度或任何敏感信息。

## 热索引

| ID | 日期 | 作用域 | 状态 | 结论 | 可复核证据 |
| --- | --- | --- | --- | --- | --- |
| REPO-001 | 2026-10-16 | 全仓库 / Agent 工作流 | 有效 | 根 AGENTS.md 为规范入口；完整规范与文档地图位于 .agents/AGENTS.md，模块变化按需同步专题文档。 | [入口](../AGENTS.md)、[完整规范](./AGENTS.md)、[结构地图](./project-map.md) |
| ANALYTICS-001 | 2026-10-17 | 统计 / 架构与口径 | 有效 | Bun + TypeScript + SQLite 单实例初版；无持久访客标识，仅统计 PV 与事件次数。接收时间按站点时区汇总，清理明细不删除长期日汇总。 | [模块](./modules/analytics.md)、[存储](../src/database.ts)、[接入](../README.md) |
| ANALYTICS-002 | 2026-10-17 | 统计 / 开发与排障 | 有效 | 验证入口 bun run typecheck、bun test；本机 Bun 1.3.5 的 db.transaction 后 close(true) 锁定问题已最小复现，现用同步显式事务，落盘重开和回滚由测试覆盖。 | [调试](./dbg.md)、[测试](../tests/app.test.ts)、[存储](../src/database.ts) |
| ANALYTICS-003 | 2026-10-17 | 统计 / 管理员测试排除 | 有效 | 看板生成站点标记链接；tracker 在首次 PV 前用 mazda_admin=1/0 或 setAdmin(boolean) 设置本地排除标记。按 origin + site 隔离，同源标签页同步；排除 PV/事件/Beacon/待发重试，存储失败仅当前文档生效。 | [模块](./modules/analytics.md)、[脚本](../public/tracker.js)、[测试](../tests/tracker.test.ts)、[说明](../README.md) |
| ANALYTICS-004 | 2026-10-17 | 统计 / 站点配置 | 有效 | WebUI 维护完整站点配置，鉴权 GET/PUT /admin/api/sites + ETag/If-Match；串行原子文件替换后热更新，默认 sites.json，支持空站点首建，移除保留历史。手工编辑文件需重启。 | [模块](./modules/analytics.md)、[持久化](../src/site-config.ts)、[测试](../tests/site-config.test.ts)、[说明](../README.md) |
| ANALYTICS-005 | 2026-10-17 | 统计 / 管理路由与鉴权 | 有效 | 管理面全部位于 /admin；网关匹配精确 /admin 与前缀 /admin/，保留路径及 Authorization。管理 API 接受 Bearer 或配置 WS_AUTH_UID_SECRET 后经 HMAC-SHA256 校验的本机 OSG UID；看板自动尝试同源网关登录。SDK、/api/collect、/health 保持公开。 | [模块](./modules/analytics.md)、[鉴权](../src/auth.ts)、[测试](../tests/auth.test.ts)、[说明](../README.md) |
| ANALYTICS-006 | 2026-10-17 | 统计 / SDK 版本 | 有效 | package.json 统一项目与 SDK 当前版本；固定地址 /mazda@<version> 读取 public/sdk 快照，/mazda 与 /tracker.js 以 302 + no-store 跳转当前版本。bun run sdk:release 生成快照并拒绝覆盖不同内容；升级保留旧文件。 | [模块](./modules/analytics.md)、[SDK](../src/sdk.ts)、[生成](../scripts/release-sdk.ts)、[测试](../tests/sdk.test.ts) |
