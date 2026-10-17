# 网站统计模块

## 职责与入口

- `src/index.ts`：运行单实例 Bun HTTP 服务，启动及每小时清理明细，退出时等待请求结束并关闭 SQLite。
- `src/app.ts`：公开采集接口、管理 Bearer 鉴权、连接来源限流、静态资源。
- `src/events.ts`：协议校验、白名单属性、路径清洗、时区日期。
- `src/database.ts`：去重与日汇总原子写入、查询、明细保留。
- `public/tracker.js`：自动/手动 PV、显式业务事件、内存队列、最多三次失败重试、Beacon。
- `public/dashboard.*`：中文看板，令牌仅存内存，数据使用 DOM textContent 呈现。
- 初始化与备份位于 `scripts/`；用户操作见 [README](../../README.md)。

## 看板界面约定

- 使用平整布局、细分隔线与小圆角，不使用渐变、重阴影或过度 Material 卡片设计；不使用松绿色主题，避免与其他模块重复。
- 配色取自 [日本传统色](https://ssshooter.github.io/nippon-color/#/)：藍鼠 `#566C73` 为主色，胡粉 `#FFFFFB` 为底色，白練 `#FCFAF2`、銀鼠 `#91989F` 和利休白茶 `#B4A582` 作辅助色，墨 `#1C1C1C` 与消炭 `#434343` 用于文字；颜色集中在 `public/style.css` 变量中。
- 图标从 [Yesicon Material Symbols](https://yesicon.app/zh-Hans/material-symbols) 查阅，使用 Google 的 SVG 路径并内嵌为 symbol，不加载外部图标字体或运行时 CDN。许可见 `licenses/material-symbols.txt`。
- 只保留标题、指标标签、筛选操作与必要状态；不再添加宣传语、统计口径解释卡、重复说明或页脚口号。统计口径与接入说明留在文档。
- 趋势纵轴使用等距整数刻度；排行细条表示相对于该榜最大值的大小，绝对次数仍直接显示。零 PV 时显示简短空态，不显示空柱状图。SVG 几何值通过属性设置，保持现有 CSP，无内联 style。
- 布局在窄屏改为单列排行，筛选与图标按钮保留可访问名称；验证需覆盖桌面、手机、1/7/30 天切换、空站点和退出。

## 协议与统计口径

- `POST /api/collect`，body `{site_id, events:[...]}`；事件需要 `v:1`、event_id、type、path，type 支持 pageview 和 event，后者要求配置过的 name。
- 必须携带与目标站点 origins 精确匹配的 Origin；SDK 使用 text/plain JSON，服务端同时支持 OPTIONS。
- 限额：32 KiB/请求、20 条/批、每连接来源 120 请求/分钟（含预检）；SDK 按字节拆批，内存队列最多 100 条。
- 校验整批后写入，任一事件无效则整批拒绝。事务提交后返回 accepted/duplicates；明细保留期内 `(site_id,event_id)` 去重。
- 服务端接收时间为事件时间，UTC 毫秒保存，按站点时区计算日期；SDK 不持久化离线数据。
- 只有 pageview 影响 PV、页面、来源、设备排行；event 影响事件总数和名称排行。来源优先级为 utm_source、外部 referrer_host、direct。
- 同文档 SPA 继承初始推广参数与来源；连续同路径不重复计 PV，查询参数/hash 不构成新页面，hash 路由需手动映射。
- 管理员测试排除：tracker 在首次 PV 前处理 `mazda_admin=1/0`，可用 `mazda_site` 限定站点；处理后通过 replaceState 移除标记参数。`window.mazda.setAdmin(boolean)` 切换、`isAdmin` 查询；排除时 page/track 返回 false，flush/Beacon 不发请求，待发队列清空，旧请求失败不再重试。
- 排除标记只在被测网站 localStorage 的 `mazda:admin:<site_id>` 保存固定值 `1`，按 origin + site 隔离，同源标签页通过 storage 事件及发送前检查同步。存储失败降级为当前文档内存，setAdmin 返回 false；取消后 page() 可重新记录当前路径。DNT/GPC 下仍处理标记但不初始化 API。
- 看板“管理员测试访问”为各 origin 生成标记/取消链接，`GET /api/sites` 在鉴权后附带 origins；链接不含管理令牌。首页未接入 tracker 时需把参数放到已接入页面；各浏览器/域名分别标记。排除是客户端主动退出采集，不是身份认证，无法撤回已发请求或历史计数。
- 不计算 UV、会话、跳出率或用户画像，不得把次数改称人数。

## 存储与边界

- SQLite schema v1：events 存清洗明细，daily_counts 按 `(site,day,dimension,value)` 存一维计数；拒绝更高版本库，后续变更需迁移。
- 明细默认 30 天，日汇总长期保留，包含清洗路径等维度；无法从过期明细重建全部历史。
- 无持久访客标识或 Cookie；浏览器本地存储仅用于管理员主动设置的排除标记，不传到服务端。原始 IP/UA 不落库。限流键是随机进程密钥 HMAC，只使用连接来源，忽略转发头。
- 路径删除 query/hash，支持配置脱敏，保守屏蔽邮箱及长令牌；不能识别全部敏感信息，站长需维护业务路径和属性白名单。
- UTM 为最多 64 字符的类别标签；medium/campaign 仅存明细，初版面板按 source 展示。
- 管理接口需 Bearer 随机令牌，不开放查询 CORS；公开管理 shell 无统计数据；令牌不放 URL、日志或浏览器持久存储。
- 站点配置修改需重启；ID 和时区修改不会重写历史归属及日期。

## 验证与限制

根目录执行 `bun run typecheck`、`bun test`。浏览器最小验证见 [dbg.md](../dbg.md)。`bun run backup` 使用 VACUUM INTO，测试覆盖 WAL 已提交数据和拒绝覆盖目标；恢复时停服务后指向备份路径，保留原库。

显式同步事务规避本机 Bun 1.3.5 db.transaction 内部语句关闭问题，事务内禁止 await。变更后必须验证回滚与文件句柄释放。

初版为本机默认监听的单实例服务，无账户体系、跨维度筛选或公网部署配置。Origin 校验不能防伪造；代理连接共享应用限流，公网接入需在可信边界按真实客户端限流；UA 机器人过滤和设备识别仅为启发式。
