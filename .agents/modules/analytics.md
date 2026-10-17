# 网站统计模块

## 职责与入口

- `src/index.ts`：运行单实例 Bun HTTP 服务，启动及每小时清理明细，退出时等待请求结束并关闭 SQLite。
- `src/app.ts`：公开采集接口、管理 Bearer 鉴权、连接来源限流、静态资源。
- `src/auth.ts`：管理令牌或本机 OSG 签名 UID 鉴权；`WS_AUTH_UID_SECRET` 配置后校验 `x-ws-uid-sig = HMAC-SHA256(uid)` 的小写 hex，常量时间比较，仅接受 socket peer 为 127.0.0.1、::1 或 ::ffff:127.0.0.1；不信任转发 IP 头。密钥不配置则仅接受管理令牌。
- `src/version.ts`：从 package.json 读取统一项目版本与当前 SDK 路径；`src/sdk.ts` 加载版本快照并处理 SDK 请求。
- `src/events.ts`：协议校验、白名单属性、路径清洗、时区日期。
- `src/site-config.ts`：站点配置版本检查、串行原子文件替换及运行时切换。
- `src/database.ts`：去重与日汇总原子写入、查询、明细保留。
- `public/tracker.js`：SDK 开发源码，自动/手动 PV、显式业务事件、内存队列、最多三次失败重试、Beacon；实际分发 `public/sdk/<version>.js` 快照。
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

- 管理面统一使用 `/admin` 与 `/admin/`：看板在这两个入口提供，脚本和样式为 `/admin/dashboard.js`、`/admin/style.css`；可选验证页及脚本为 `/admin/demo`、`/admin/demo.js`，模拟 SPA 路径也位于 `/admin/demo/article`。旧根路径和旧管理接口不再提供管理功能，不保留别名。
- 网关鉴权规则需覆盖精确 `/admin` 和前缀 `/admin/`，保留转发路径和 Authorization；应用管理 API 接受 Bearer 令牌或合法的本机网关签名 UID。网关必须删除/覆盖客户端自报 `x-ws-uid`、`x-ws-uid-sig` 并基于真实会话重写；签名证明已登录身份，允许访问统计管理面的用户范围由网关限制。公开 `/mazda`、`/mazda@<version>`、兼容地址 `/tracker.js`、`/api/collect`（含 OPTIONS）和 `/health` 可独立放行。页面 shell 本身不含配置或统计数据，由网关按需保护。
- 项目与 SDK 当前版本统一使用 package.json 的 version；启动日志及 `/health` 返回该版本。`/mazda`、`/tracker.js` 以 302 + no-store 重定向至当前 `/mazda@<version>`，保留查询参数。固定路径只读取对应快照，GET/HEAD 返回一年 immutable 缓存与公开 CORS，未知版本返回 404，不回退；其他请求方法返回 405。
- `bun run sdk:release` 将 public/tracker.js 生成为 public/sdk/<version>.js，使用独占创建且拒绝同版本不同内容；升级须修改 package.json、生成新快照、保留历史快照后重启。服务启动加载所有快照，缺少当前版本即报错。看板接入代码及 demo 的 `__MAZDA_SDK_PATH__` 在静态资源加载时由服务替换为当前固定路径，不在浏览器读取 package.json。
- 管理看板“站点配置”使用表单维护 ID、名称、origins、时区、事件及属性白名单、路径脱敏规则，并生成接入代码。支持空站点首建与移除最后一个站点；已有 ID 在表单中只读，移除需二次确认，历史统计保留。
- `GET /admin/api/sites` 鉴权后返回完整配置数组与 ETag；`PUT /admin/api/sites` 接收完整数组（0–100 站点，最多 4 MiB），要求 If-Match。缺少版本返回 428，冲突返回 409，无效配置返回 400。采集仍限 32 KiB，Bun 服务总上限设为 4 MiB。
- 配置保存排队串行执行，先校验版本及完整输入，再检查磁盘是否被外部修改，写同目录临时文件并 rename 替换；成功后才替换 config.sites。失败保持运行配置，临时文件尽力清理。仅支持单实例，不提供跨进程文件锁；手工修改文件需重启。并发冲突时页面保留草稿，重新载入后再编辑。
- SITE_CONFIG 默认 sites.json；缺少文件或空数组允许启动，网页首次保存创建文件。服务需要目录写权限，初始化仍生成示例站点配置。配置文件为本地持久化来源，无 SQLite schema 变更。

- `POST /api/collect`，body `{site_id, events:[...]}`；事件需要 `v:1`、event_id、type、path，type 支持 pageview 和 event，后者要求配置过的 name。
- 必须携带与目标站点 origins 精确匹配的 Origin；SDK 使用 text/plain JSON，服务端同时支持 OPTIONS。
- 限额：32 KiB/请求、20 条/批、每连接来源 120 请求/分钟（含预检）；SDK 按字节拆批，内存队列最多 100 条。
- 校验整批后写入，任一事件无效则整批拒绝。事务提交后返回 accepted/duplicates；明细保留期内 `(site_id,event_id)` 去重。
- 服务端接收时间为事件时间，UTC 毫秒保存，按站点时区计算日期；SDK 不持久化离线数据。
- 只有 pageview 影响 PV、页面、来源、设备排行；event 影响事件总数和名称排行。来源优先级为 utm_source、外部 referrer_host、direct。
- 同文档 SPA 继承初始推广参数与来源；连续同路径不重复计 PV，查询参数/hash 不构成新页面，hash 路由需手动映射。
- 管理员测试排除：tracker 在首次 PV 前处理 `mazda_admin=1/0`，可用 `mazda_site` 限定站点；处理后通过 replaceState 移除标记参数。`window.mazda.setAdmin(boolean)` 切换、`isAdmin` 查询；排除时 page/track 返回 false，flush/Beacon 不发请求，待发队列清空，旧请求失败不再重试。
- 排除标记只在被测网站 localStorage 的 `mazda:admin:<site_id>` 保存固定值 `1`，按 origin + site 隔离，同源标签页通过 storage 事件及发送前检查同步。存储失败降级为当前文档内存，setAdmin 返回 false；取消后 page() 可重新记录当前路径。DNT/GPC 下仍处理标记但不初始化 API。
- 看板“管理员测试访问”为各 origin 生成标记/取消链接，`GET /admin/api/sites` 在鉴权后附带 origins；链接不含管理令牌。首页未接入 tracker 时需把参数放到已接入页面；各浏览器/域名分别标记。排除是客户端主动退出采集，不是身份认证，无法撤回已发请求或历史计数。
- 不计算 UV、会话、跳出率或用户画像，不得把次数改称人数。

## 存储与边界

- SQLite schema v1：events 存清洗明细，daily_counts 按 `(site,day,dimension,value)` 存一维计数；拒绝更高版本库，后续变更需迁移。
- 明细默认 30 天，日汇总长期保留，包含清洗路径等维度；无法从过期明细重建全部历史。
- 无持久访客标识或 Cookie；浏览器本地存储仅用于管理员主动设置的排除标记，不传到服务端。原始 IP/UA 不落库。限流键是随机进程密钥 HMAC，只使用连接来源，忽略转发头。
- 路径删除 query/hash，支持配置脱敏，保守屏蔽邮箱及长令牌；不能识别全部敏感信息，站长需维护业务路径和属性白名单。
- UTM 为最多 64 字符的类别标签；medium/campaign 仅存明细，初版面板按 source 展示。
- 管理接口需 Bearer 随机令牌或经共享密钥校验的本机网关身份，不开放查询 CORS；公开管理 shell 无统计数据；令牌、签名密钥不放 URL、日志或浏览器持久存储。看板启动通过同源请求自动尝试网关登录，不发送空 Bearer；失败保留令牌登录表单。退出清理当前页面状态，不注销网关会话，刷新重新尝试自动登录。
- 网页保存站点配置立即生效，无需重启；手工改文件需重启。ID 和时区修改不会重写历史归属及日期，已接收请求不会被追溯修改。

## 验证与限制

根目录执行 `bun run typecheck`、`bun test`。浏览器最小验证见 [dbg.md](../dbg.md)。`bun run backup` 使用 VACUUM INTO，测试覆盖 WAL 已提交数据和拒绝覆盖目标；恢复时停服务后指向备份路径，保留原库。

`tests/site-config.test.ts` 覆盖鉴权、版本冲突、并发保存、无效配置、写盘失败、外部修改保护、空配置、即时采集切换和文件重载；修改配置流程时优先运行该文件。

`tests/auth.test.ts` 覆盖 OSG UID 签名、错误/缺失/重复身份头、外部连接伪造转发头、未配置密钥时拒绝、原有 Bearer 兼容，以及真实 HTTP 配置读写、ETag 冲突和配置落盘后的新进程重载。

`tests/sdk.test.ts` 覆盖固定版本/CORS/HEAD/缓存、无版本跳转、未知版本、升级保留旧版、快照防覆盖和当前快照缺失；`tests/app.test.ts` 用真实 HTTP 验证重定向跟随及看板接入路径，`tests/tracker.test.ts` 执行当前版本快照。SDK 源码与当前快照须一致，修改后按版本流程重新生成。

显式同步事务规避本机 Bun 1.3.5 db.transaction 内部语句关闭问题，事务内禁止 await。变更后必须验证回滚与文件句柄释放。

初版为本机默认监听的单实例服务，无账户体系或跨维度筛选；实际部署配置、状态和运维记录仅保存在根目录 `_internal/`。Origin 校验不能防伪造；代理连接共享应用限流，公网接入需在可信边界按真实客户端限流；UA 机器人过滤和设备识别仅为启发式。
