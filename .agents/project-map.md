# 项目结构与模块地图

## 当前结构

当前为 Bun + TypeScript + SQLite 个人网站统计服务：

```text
mazda/
├── src/                       # 配置、HTTP、事件清洗、SQLite 与启动入口
├── public/                    # 采集脚本、中文看板、样式与最小 demo
├── scripts/                   # 初始化与一致性快照备份
├── tests/                     # 功能、HTTP、SDK、初始化与备份测试
├── package.json               # Bun 命令与开发依赖
├── bun.lock                   # 锁定的开发依赖
├── tsconfig.json
├── sites.example.json         # 无敏感信息的站点示例
├── .env.example               # 环境模板，令牌为不可用占位值
├── README.md                  # 启动、接入、数据口径与限制
├── .git/                       # 本地 Git 元数据，不纳入版本控制
├── .gitignore                  # 敏感文件与常见本地临时产物的排除规则
├── AGENTS.md                   # 整个仓库的 Agent 入口
└── .agents/
    ├── AGENTS.md               # 完整规范、关键红线、文档地图
    ├── MEMORY.md               # 精简的跨对话记忆热索引
    ├── project-map.md          # 本文档：结构和模块职责
    ├── development.md          # 开发与验证约定
    ├── dbg.md                  # 调试约定
    └── memory/
        └── archive/
            └── README.md      # 按月归档与检索规则
```

本地 `.env`、`sites.json`、`data/`、`node_modules/`、`.tmp/` 被 Git 忽略。初始化生成的管理令牌只保留在本地配置中；验证截图和探针位于 `.tmp/`。

## 架构与模块登记

唯一业务模块为 [analytics](./modules/analytics.md)，入口 `src/index.ts`。配置、路由、事件、存储分别位于 src/config.ts、app.ts、events.ts、database.ts。运行基线 Bun 1.3.5；TypeScript 5.9.3、@types/bun 1.3.5 仅为开发依赖。运行时无第三方依赖，无 Redis、消息队列或远程服务依赖。协议 v1 为当前实现格式，尚未由用户确认为冻结协议；未发布或部署。

## 更新时机

- 新增应用、模块或共享组件。
- 改变目录职责、模块边界或主要依赖关系。
- 确认技术栈、持久化方式、接口协议或部署方案。

结构是否仍然有效，应通过 `Get-ChildItem -Force` 和 `rg --files --hidden -g '!.git'` 与当前文件交叉验证。
