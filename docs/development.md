# 开发约定与进度

本项目使用 Node.js 24 LTS、TypeScript、React、Fastify 和 PostgreSQL 18（当前稳定系列；PostgreSQL 没有独立 LTS 分支）。依赖使用当前稳定版并通过 package-lock.json 固定；不使用预发布版本。

## 开发约定

- 每次修改代码，同步更新 docs/ 中相关文档，并一起提交。
- 在 codex/multi-user-typst-blog 分支开发，完成一个可验证的小部分后 commit & push。
- 提交信息使用英文 Conventional Commits。
- 默认公开浏览文章；用户仅管理自己名下的来源和文件。
- GitHub 来源默认使用公开仓库，指定分支后手动同步。待用户确认其他可见性需求。

## 数据与边界

PostgreSQL 保存 GitHub 身份、服务端会话、来源、虚拟文件和发布快照。虚拟路径使用 POSIX 相对路径；不映射到服务器共享目录。每个来源归属于一个用户，所有管理查询都校验归属。

文件来源分为上传工作区和 GitHub 仓库快照。files 是草稿，posts 是上次成功发布的内容。选中的 .typ 文件是编译入口，整个来源提供编译依赖；选中的 .md/.markdown 文件生成 Markdown 阅读页。未选中的文件保持私有。

## 阶段

1. 已完成：项目骨架、PostgreSQL schema、事务与初始化接口。
2. 已完成：GitHub OAuth（state + PKCE）、服务端会话、CSRF 防护。
3. 已完成：上传/下载/编辑/删除/移动、保留目录、公开仓库分支同步、原子更新。
4. 待完成：发布、Typst 编译、阅读界面。
5. 待完成：端到端验证、部署说明。

Schema 初始化使用事务和 PostgreSQL advisory lock。后续改变已有表结构需要添加明确 ALTER/迁移，不能仅依赖 CREATE TABLE IF NOT EXISTS。

## 官方参考

- [Node.js LTS 时间表](https://github.com/nodejs/Release)
- [PostgreSQL 下载与稳定版本](https://www.postgresql.org/download/)
- [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [PDF.js](https://mozilla.github.io/pdf.js/getting_started/)
- [Typst 项目根隔离](https://typst.app/docs/reference/foundations/path/)
