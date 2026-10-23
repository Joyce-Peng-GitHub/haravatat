# 开发约定与进度

本项目使用 Node.js 24 LTS、TypeScript、React、Fastify 和 PostgreSQL 18（当前稳定系列；PostgreSQL 没有独立 LTS 分支）。依赖使用当前稳定版并通过 package-lock.json 固定；不使用预发布版本。

## 开发约定

- 每次修改代码，同步更新 docs/ 中相关文档，并一起提交。
- 在 codex/multi-user-typst-blog 分支开发，完成一个可验证的小部分后 commit & push。
- 提交信息使用英文 Conventional Commits。
- 默认公开浏览文章；用户仅管理自己名下的来源和文件，未来可添加文章访问控制。
- HTTPS Git 仓库来源支持手动同步或打开工作台时自动同步，公开仓库无需 token，私有仓库可单次提供 PAT 或显式加密保存。

## 数据与边界

PostgreSQL 保存 GitHub 身份、服务端会话、来源、虚拟文件和发布快照。虚拟路径使用 POSIX 相对路径；不映射到服务器共享目录。每个来源归属于一个用户，所有管理查询都校验归属。

文件来源分为上传工作区和 HTTPS Git 仓库快照。files 是草稿，posts 是上次成功发布的内容。选中的 .typ 文件是编译入口，整个来源提供编译依赖；选中的 .md/.markdown 文件生成 Markdown 阅读页。未选中的文件保持私有。

## 阶段

1. 已完成：项目骨架、PostgreSQL schema、事务与初始化接口。
2. 已完成：GitHub OAuth（state + PKCE）、服务端会话、CSRF 防护。
3. 已完成：上传/下载/编辑/删除/移动、保留目录、仓库分支同步、原子更新。
4. 已完成：原子发布、独立 Typst 编译服务、PDF 连续阅读、Markdown、响应式工作台。
5. 已完成：桌面/手机与生产静态站点端到端验证、Docker Compose、PostgreSQL CI、部署文档。

Schema 初始化使用事务和 PostgreSQL advisory lock。后续改变已有表结构需要添加明确 ALTER/迁移，不能仅依赖 CREATE TABLE IF NOT EXISTS。

## 官方参考

- [Node.js LTS 时间表](https://github.com/nodejs/Release)
- [PostgreSQL 下载与稳定版本](https://www.postgresql.org/download/)
- [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [PDF.js](https://mozilla.github.io/pdf.js/getting_started/)
- [Typst 项目根隔离](https://typst.app/docs/reference/foundations/path/)

工作区配额集中在 shared/limits.ts（1 GiB / 1024 文件，无独立单文件上限），前后端共用。storage.ts 封装内联/分块 PostgreSQL 文件存储；uploads.ts 供应用上传与内部编译服务复用流式读取和配额校验。Docker 三个构建目标均包含 shared/。容量修改需同时检查数据库传输、编译协议、容器资源和 docs/files.md、docs/deployment.md。

credentials.ts 封装仓库凭据的加密存取，密文与 sources 分表，来源 API 不读取或返回密文。数据库新增 auto_sync 字段及 repository_credentials 表，启动迁移保持可重入；既有工作区默认关闭自动同步。工作台仅在进入仓库时调用已有同步 API，服务端没有定时任务。FileTree.tsx 处理目录结构、筛选和折叠，入口选择与发布仍由 Dashboard 管理。

## Markdown 解析维护

发布与阅读共享 shared/markdown.ts 的括号数学 tokenizer，并启用 remark-math。新增语法必须验证「原始 Markdown → 发布快照 → React 阅读」全链路，不能仅测试未发布的原文。web/src/markdown-config.ts 提供实际阅读插件配置；高亮和 alert 只作用于展示 AST。依赖使用 KaTeX 0.19.0，并通过 npm override 让 rehype-katex 的排版引擎与导入的 CSS/字体使用同一版本，避免嵌套旧版本引擎造成样式不匹配。

tests/markdown.test.ts 运行真实发布转换和 React 阅读插件，覆盖各类公式定界符、嵌套引用内的多行公式、代码原文、公式资源隔离、嵌套格式高亮、五类 alert、GFM 及不可信公式/HTML。浏览器测试还经过上传和发布接口，检查公式 DOM、字体加载及手机页面宽度。
