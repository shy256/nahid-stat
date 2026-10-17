# 调试约定

## 最小复现优先

1. 从实际错误提取最小输入、触发步骤、预期行为和实际行为。
2. 大型模块优先缩小到能复现问题的最小示例，避免反复启动整个系统。
3. 修复后用相同复现步骤验证，再按影响范围运行相关检查。

## 严重依赖真实浏览器的模块

按“编写最小测试 → 运行 HTTP 服务 → 调试工具调试”开展：

1. 编写仅保留必要脚本、样式、接口和输入的最小测试页面或已有框架测试。
2. 使用项目已确认的开发服务器启动本地 HTTP 服务，记录地址和端口。仅需静态服务且已安装 Python 时，可在最小示例目录运行 `python -m http.server 8000 --bind 127.0.0.1`。
3. 用当前环境可用的浏览器调试工具打开该地址，检查控制台、网络请求、DOM 和事件；先按实际工具文档确认支持的操作。记录复现步骤及结论，结束后停止本次启动的临时服务。

### 统计模块最小验证

1. 使用独立测试数据库，将 `.env` 中 `ENABLE_DEMO=true`；示例站点 my-blog 允许 http://127.0.0.1:3000。示例数据会真实写入，不能混入正式数据库。
2. `bun run start` 后打开 `/admin/demo`；首次展示增加 1 PV，模拟下载增加 1 个 download，切换示例文章增加 1 PV，重复当前路由不增加 PV。
3. 进入 `/admin`，输入当前本地服务的管理令牌，核对 2 PV / 1 事件、页面 /admin/demo 与 /admin/demo/article，不含查询参数。检查控制台、7/30 天切换和手机布局。
4. 在看板展开“管理员测试访问”，核对各域名的标记/取消链接不含令牌。在 `/admin/demo?mazda_admin=1&mazda_site=my-blog` 设置标记，刷新、模拟下载、SPA 切换后统计不应增加；另一个同源标签页也应排除。访问 `/admin/demo?mazda_admin=0&mazda_site=my-blog` 后首次 PV 和 download 恢复计数，确认查询标记已从地址栏移除。
5. 验证站点管理时使用隔离 SITE_CONFIG 和数据库，避免修改真实配置。以空数组启动，在 WebUI 新建 my-blog，允许当前服务 origin 并配置 download/file_type；保存后访问 /admin/demo，刷新看板核对采集，无需重启。覆盖编辑、非法时区/正则提示、移除确认/取消、最后一个站点空态、重新登录后配置保留、390px 手机布局及控制台。并发版本和写盘失败用 bun test tests/site-config.test.ts 验证。

已使用 `mcp__cua_repl` 内置浏览器验证。首次按工具说明通过 `cua.createBrowserTab("iab", url, { visible: false })` 建立标签页；按返回文档使用 Playwright locators、getAXState、截图及 tab.dev.logs。API 以当次文档为准。普通验证保持后台，结束后恢复临时视口覆盖，关闭临时标签页与服务。

静态文件在服务启动时缓存；非 watch 模式修改后需重启服务并重载页面。`.tmp/` 存放隔离探针和截图，不纳入版本控制。

### Bun 1.3.5 SQLite 关闭问题

最小示例显示：Database 的 db.transaction(fn)() 执行后，close(true) 抛出 database is locked，Windows 文件句柄可能延迟释放。当前使用同步 BEGIN IMMEDIATE / COMMIT / ROLLBACK，事务内无 await，关闭时释放语句并 close(true)。落盘重开、删除隔离数据库和回滚已由测试覆盖。升级后应重新验证，不推广到所有 Bun 版本。

## WSL Redis

- 仅在任务确实需要 Redis 时使用，不因本规范而引入 Redis 依赖。
- 先用 `wsl --list --verbose` 查看已安装发行版，再选择实际存在的发行版执行检查。
- 示例：`wsl -d <发行版> -- redis-cli ping`；`<发行版>` 必须替换为实际名称，并根据已确认的端口和认证配置调整。
- 安装、启动或更改 Redis 配置前，先确认现有状态和项目需要；不得擅自修改已有数据或暴露网络监听。
- 不把 Redis 密码、连接凭据或敏感数据写入命令示例、日志摘录或记忆。
