# 开发与验证约定

## 环境与命令边界

- 当前工作环境：Windows、PowerShell；仓库目录 `J:\mazda`。
- 运行时与包管理器为 Bun，验证基线 1.3.5；代码为 TypeScript，存储为 Bun 内置 SQLite。
- 运行时无第三方依赖；`bun install` 安装锁定的类型与编译检查依赖。
- 若需要 Redis，使用 WSL 中的版本；状态检查与调试见 [dbg.md](./dbg.md)。

## 开发命令

以下命令均在仓库根目录运行：

| 命令 | 前置条件与行为 |
| --- | --- |
| `bun install` | 安装 `bun.lock` 中的开发依赖 |
| `bun run setup` | 创建本地配置，不覆盖已有文件；已用隔离目录验证 |
| `bun run dev` | 需有效 ADMIN_TOKEN，watch 模式，默认监听 127.0.0.1:3000 |
| `bun run start` | 需有效 ADMIN_TOKEN；HTTP 启动已通过真实浏览器验证 |
| `bun run typecheck` | TypeScript 静态检查 |
| `bun test` | 功能、HTTP、SDK、初始化与备份测试 |
| `bun run backup` | 需文件数据库，一致性快照到 data/backups；已验证 WAL 场景 |

首次接入流程见 [README](../README.md)。随机管理令牌仅从本地 `.env` 查看。数据库 schema 为 v1，引入后续 schema 时需显式迁移，不能仅重写 user_version。

## 常用仓库检查

以下命令在仓库根目录运行：

```powershell
# 查看包含隐藏项的顶层结构
Get-ChildItem -Force

# 查找工作树文件，包含被默认隐藏的 Agent 文档，排除 Git 元数据
rg --files --hidden -g '!.git'

# 查看分支与改动；初始化后首次提交前会显示尚无提交
git status --short --branch

# 查看工作树和暂存区的差异及空白错误
git diff
git diff --cached
git diff --check
git diff --cached --check
```

`git diff` 不展示未跟踪文件内容；首次新增文档时需同时检查 `git status` 并直接读取文件。空白检查通过只说明对应差异没有空白错误，不代表业务测试通过。

## 变更验证

- 文档变更：核对相对链接、目录树、命令和事实是否一致。
- 代码变更：优先运行能覆盖问题的最小示例或现有相关测试，再按影响范围补充集成验证。
- 严重依赖真实浏览器的行为：使用最小页面和 HTTP 服务复现，详见 [dbg.md](./dbg.md)。
- 统计模块除测试与类型检查外，应覆盖首次 PV、自定义事件、SPA 路由去重、参数清洗及看板显示；具体流程见 [dbg.md](./dbg.md)。

## Git 工作流

- 检查当前分支和已有改动后再修改；不要覆盖与任务无关的改动。
- 提交前检查实际待提交内容和 `.gitignore` 规则，确保敏感信息与本地临时产物未被纳入。
- 只在用户授权范围内提交、配置远程或推送；不要自行改写用户身份、历史或其他 Git 配置。
