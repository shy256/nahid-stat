# Mazda Analytics

基于 Bun、TypeScript 和 SQLite 的个人网站统计服务。运行时无第三方依赖，一套服务提供采集脚本、统计 API 和中文管理看板。

当前版本 **0.1.0**，项目与 SDK 的当前版本统一取自 `package.json` 的 `version`；启动日志和 `/health` 返回运行版本。

## 已实现

- WebUI 新增、编辑和移除站点，配置保存后立即生效并持久化；精确到 HTTP(S) origin 的采集来源白名单。
- PV、每日趋势、热门页面、引流来源、设备大类、自定义事件次数。
- 自动页面采集、SPA History 路由监听、手动埋点、短暂失败重试、页面隐藏时 Beacon 上报。
- 管理员浏览器标记，测试访问与自定义事件不计入统计，可随时取消。
- 事件 ID 去重，明细与日汇总原子写入；时间以服务端接收时间为准，按站点时区划分统计日。
- 查询参数移除、路径脱敏规则、自定义事件及属性白名单；不存 IP、完整 UA、Cookie 或持久访客 ID。
- Bearer 管理令牌、公开接口限流、请求体和批次数限制、已知机器人 UA 过滤。
- 默认 30 天明细保留、长期日汇总、SQLite 一致性快照备份。

当前不计算 UV、会话、跳出率、停留时长、地理位置或性能指标，也没有登录账户体系。设备和机器人识别仅为 UA 启发式估算。

## 快速启动

要求 Bun **1.3.5 或更高版本**；以下命令在仓库根目录执行：

```powershell
bun install
bun run setup
bun run dev
```

`setup` 会创建被 Git 忽略的 `.env` 与 `sites.json`，生成随机管理令牌，不覆盖已有文件。打开 [本地看板](http://127.0.0.1:3000/admin)，输入本地 `.env` 中的 `ADMIN_TOKEN`。令牌只保留在页面内存；刷新或退出后需要重新输入。

如果手动复制 `.env.example`，必须替换令牌占位值，否则服务拒绝启动。Bun 自动加载 `.env`；进程环境变量优先。正式运行用 `bun run start`。

## 配置站点

登录看板后点击“站点配置”，选择已有站点或“新增站点”，填写站点 ID、名称、允许的域名和时区。自定义事件可逐项添加，属性白名单用英文逗号分隔；域名和路径脱敏规则每行一条。点击“保存配置”后立即生效，无需重启，并生成对应的接入代码。

配置保存在 `SITE_CONFIG` 指向的本地文件（默认 `sites.json`），重启后保留。配置文件不存在或内容为 `[]` 时，看板支持直接添加第一个站点。移除站点前有二次确认；移除后停止采集并隐藏该站点，但保留数据库内的历史统计，重新添加同一 ID 可继续查询。已有站点的 ID 在表单中只读。

多个页面同时编辑时会检查配置版本，过期保存会被拒绝；通过“重新载入”读取最新配置后再编辑。保存失败时运行配置保持原值。服务进程需要配置目录和文件的写入权限。

也可手工编辑配置文件，手工修改后需重启服务；网页会拒绝覆盖检测到的外部修改。例如：

```json
[
  {
    "id": "my-blog",
    "name": "我的博客",
    "origins": ["https://blog.example.com"],
    "timezone": "Asia/Shanghai",
    "events": { "download": ["file_type"], "subscribe": [] },
    "redactPaths": ["^/users/[^/]+", "^/reset/[^/]+"]
  }
]
```

- `origins` 必须包含协议和非默认端口，不含路径或末尾 `/`。站点的多个来源视为同一统计站点。
- `events` 是允许的事件名称及属性白名单。未配置的事件会使整批请求被拒绝；不要上报任意事件名称。
- `redactPaths` 是站长维护的可信正则表达式；匹配部分替换为 `/[redacted]`。配置敏感路径时优先使用锚定、无灾难性回溯的简单模式。
- 启用采集前配置好时区；历史日汇总不会因时区修改而重新计算。
- ID 是稳定的数据归属键；修改或移除站点配置不会自动删除数据库内已有数据。

环境变量：

| 名称 | 默认值 / 要求 |
| --- | --- |
| `ADMIN_TOKEN` | 必填，至少 24 个字符，建议使用 setup 生成的 256 位随机令牌 |
| `HOST` / `PORT` | `127.0.0.1` / `3000` |
| `SITE_CONFIG` | `sites.json`；缺少文件时以空站点启动，首次网页保存时创建 |
| `DATABASE_PATH` | `data/analytics.sqlite` |
| `RETENTION_DAYS` | `30`，允许 1–365，仅控制事件明细 |
| `ENABLE_DEMO` | `false`；设为 `true` 后提供 `/admin/demo` 最小验证页 |

## 网站接入

将实际网站 origin 加入站点配置，并在网站 HTML 中插入：

```html
<script defer src="https://stats.example.com/mazda@0.1.0" data-site="my-blog"></script>
```

`/mazda@0.1.0` 固定使用该版本；看板生成的接入代码也固定到当前版本。希望自动跟随最新版时可使用无版本地址：

```html
<script defer src="https://stats.example.com/mazda" data-site="my-blog"></script>
```

`/mazda` 和兼容旧接入的 `/tracker.js` 均以 `302` 重定向到当前 `/mazda@<version>`，保留查询参数，且不缓存重定向。固定版本支持 GET/HEAD、跨域加载与一年 immutable 缓存；不存在的版本返回 404，不回退到最新版。

脚本自动采集首次展示、History 路由路径变化、前进后退以及 BFCache 恢复。仅查询参数或 hash 变化不增加 PV。SPA 自动监听在 History 调用后立即读取路径；复杂框架可关闭自动模式，在路由完成后显式调用：

```html
<script defer src="https://stats.example.com/mazda@0.1.0" data-site="my-blog" data-auto="false"></script>
```

```js
// 在脚本加载完成及路由完成后调用；hash 路由需要自行映射为稳定路径。
window.mazda?.page({ path: "/posts/example" });
// 在实际操作成功后上报；属性只使用非敏感、低基数的类别值。
window.mazda?.track("download", { file_type: "pdf" });
```

`page()` 连续上报同一路径只记一次；SDK 不自动监控 DOM 点击或表单。网站自身启用 CSP 时，需允许统计域名的 `script-src` 和 `connect-src`。

脚本尊重浏览器 DNT=`1` 和 GPC 信号，此时不初始化 `window.mazda`，所以示例使用可选链。不使用 Cookie、sessionStorage、持久访客 ID 或持久队列；localStorage 仅用于管理员主动设置的排除标记。广告拦截、离线、浏览器退出或 Beacon 未送达均可能丢失事件。

### 排除管理员测试访问

登录看板，选择站点并展开“管理员测试访问”，在对应域名点击“标记管理员浏览器”。链接会打开被测网站，在首次 PV 前设置标记；之后该浏览器在此域名、此站点的 PV、SPA 路由和自定义事件均不再上报，刷新和重新打开浏览器仍生效。点击“取消标记”可恢复正常统计。

也可以在已接入采集脚本的网站地址后添加参数（已有查询参数时使用 `&`）：

```text
https://blog.example.com/?mazda_admin=1&mazda_site=my-blog
https://blog.example.com/?mazda_admin=0&mazda_site=my-blog
```

`1` 为标记，`0` 为取消；`mazda_site` 必须与脚本的 `data-site` 一致，省略时作用于当前脚本的站点。标记参数处理后从当前地址中移除，保留其他查询参数与 hash。看板链接默认打开域名首页；如果首页没有采集脚本，将同样的参数加到已接入脚本的页面再访问。

网站自身的管理界面也可在脚本加载后调用：

```js
const persisted = window.mazda?.setAdmin(true); // true 表示已持久保存；false 表示仅当前页面生效
const excluded = window.mazda?.isAdmin;         // 当前是否排除统计
window.mazda?.setAdmin(false);                 // 取消标记
window.mazda?.page();                          // 取消后按需记录当前页面
```

标记以 `mazda:admin:<site_id>` 键在被测网站的 localStorage 保存，只包含固定值 `1`，不保存管理令牌或身份信息，也不会发送到采集服务。同源的其他标签页会同步排除并清空待发队列。不同域名、浏览器、设备或无痕窗口需分别标记；清除网站存储会移除标记。本地存储不可用或写入失败时仅在当前页面生效，刷新后需重新标记。DNT/GPC 开启时仍处理主动标记，但不启用采集 API。

标记只是排除当前浏览器流量，不授予管理权限；不能撤回已发送的请求或删除已有统计。测试前先通过标记链接进入网站。

## 接口

公开接口：

```http
POST /api/collect
Origin: https://blog.example.com
Content-Type: text/plain;charset=UTF-8

{"site_id":"my-blog","events":[{"v":1,"event_id":"e8b8369578054b599c44dd2048fc9ebc","type":"pageview","path":"/posts/example","referrer_host":"www.google.com"}]}
```

事件 ID 允许字母、数字、下划线、连字符；UUID 可用。`type` 支持 `pageview` 和 `event`；自定义事件还需要 `name`，`props` 可选。可选推广字段为 `utm_source`、`utm_medium`、`utm_campaign`。SDK 只读取这些查询参数，默认丢弃其余查询参数和 hash。

成功响应为 `{"accepted":1,"duplicates":0}`。最多 20 条/批、32 KiB/请求；服务端先校验整批，任一事件无效时不写入任何事件。重复事件在明细保留期内按 `(site_id, event_id)` 去重，过期后不保证去重。数据库事务提交后才返回成功。

管理看板位于 `/admin`（同时支持 `/admin/`），页面脚本、样式、可选验证页和管理接口全部位于 `/admin/` 下。网关统一鉴权时需同时匹配精确路径 `/admin` 和前缀 `/admin/`，并将原始路径转发给服务，不剥离前缀。应用内管理接口仍要求 `Authorization: Bearer <ADMIN_TOKEN>`，网关需保留该请求头。

原 `/`、`/dashboard.js`、`/style.css`、`/demo`、`/demo.js`、`/api/sites` 和 `/api/stats` 不再提供管理功能。公开 `/mazda`、`/mazda@<version>`、兼容地址 `/tracker.js`、`/api/collect`（含 OPTIONS）和 `/health` 可独立放行，网关需允许 SDK 重定向的目标路径。

管理接口：

| 接口 | 返回内容 |
| --- | --- |
| `GET /admin/api/sites` | 完整站点配置数组：id、name、timezone、origins、events、redactPaths；响应 ETag 为配置版本 |
| `PUT /admin/api/sites` | 请求体为完整站点配置数组（0–100 个，最多 4 MiB）；必须带 GET 返回的 `If-Match: <ETag>`，成功返回新配置及 ETag |
| `GET /admin/api/stats?site_id=my-blog&days=7` | 合计、每日趋势、页面/来源/设备/事件排行 |

`GET /health` 是公开进程健康检查，返回 `{ "status": "ok", "version": "0.1.0" }`，不返回配置或统计数据。

`days` 仅支持 `1`、`7`、`30`，均包含站点当地的今天。排行最多 20 项。来源按 `utm_source → 外部来源域名 → 直接访问/未知` 优先级统计页面浏览量；同一文档的 SPA 页面继承该文档初始推广参数和来源。UTM medium/campaign 保存于清洗后的明细，初版面板不提供对应筛选。

配置写入沿用 Bearer 鉴权且不开放 CORS。无效配置返回 400，缺少 If-Match 返回 428，版本冲突或检测到外部文件修改返回 409。采集请求仍限制为 32 KiB。

## 数据与运行边界

- 明细不存原始 IP、UA 或请求头；连接 IP 仅用于进程内限流，键使用每次启动随机密钥的 HMAC。
- 每连接来源每分钟最多 120 个采集请求（含预检）；限流表上限 10,000 项。当前忽略 `X-Forwarded-For`，经过反向代理的客户端会共享代理连接 IP 的限额；公网接入前应在可信代理边界处理客户端限流。
- Origin/CORS 是接入边界，无法防止非浏览器客户端伪造访问。公开 site ID 不是密钥。
- 原始事件默认保留 30 天，启动及每小时清理。日汇总仍含清洗后的页面/来源等维度且长期保留；删除明细不等于删除汇总。
- 邮箱路径和常见长令牌片段会被保守屏蔽，但无法识别所有敏感信息；仍需为业务路径设置 `redactPaths`，不要在允许的属性或 UTM 标签中放入个人信息。
- 日汇总是预先维护的一维计数，初版不支持跨维度交叉筛选或从已清理明细重建历史。
- 默认仅监听本机；对外使用应通过 HTTPS 反向代理，管理接口最好限制网络访问。服务自身不记录完整请求日志，代理日志也应避免保留令牌或采集内容。
- 这是单实例初版；统计正确性优先于高吞吐，SQLite 操作同步执行。扩容前先测量实际请求量与数据库延迟。

## 备份与恢复

```powershell
bun run backup
# 或指定一个尚不存在的备份文件
bun run backup data/backups/manual.sqlite
```

命令用 `VACUUM INTO` 生成一致性快照，可读取正在使用的 WAL 数据；目标存在时拒绝覆盖。备份保存在被 Git 忽略的 `data/` 中，也需按数据保留要求管理。

恢复时停止服务，将 `.env` 的 `DATABASE_PATH` 改为选定的备份文件路径，再启动；无需覆盖原数据库。恢复前保留原库供回退，不要仅复制运行中的 `.sqlite` 主文件，也不要随意删除配套 WAL 文件。

## 验证

```powershell
bun run typecheck
bun test
```

测试覆盖去重、清洗、白名单、批次原子性、事务失败回滚、来源隔离、鉴权、限流、请求大小、时区、明细清理、落盘重开、HTTP 请求，以及脚本的 SPA 去重、重试 ID、Beacon 与 DNT。

本地浏览器验证：在 `.env` 中设置 `ENABLE_DEMO=true`，保留示例 `my-blog` 配置和本机 origins，重启后访问 [最小接入页](http://127.0.0.1:3000/admin/demo)。首次展示应增加 1 PV，模拟下载增加 1 个 download，切换示例文章再增加 1 PV，重复当前路由不增加 PV。结束后可关闭 demo；示例数据是真实写入，若需与个人网站隔离，请使用单独数据库。

## 版本更新

SDK 源码在 `public/tracker.js`，已生成的版本快照在 `public/sdk/<version>.js`。修改 SDK 后，先提升 `package.json` 的 `version`，再在根目录执行：

```powershell
bun run sdk:release
bun run typecheck
bun test
```

`sdk:release` 仅生成本地快照，不发布或部署；同版本内容一致时可重复执行，内容不同时拒绝覆盖。保留旧快照并将新快照与版本号一起纳入版本控制，随后重启服务，`/mazda` 即指向新版本，历史版本 URL 继续提供原内容。缺少当前版本快照时服务拒绝启动。项目升级时也需生成对应版本快照，SDK 未变时允许不同版本快照内容一致；同步更新本文的当前版本和接入示例。
