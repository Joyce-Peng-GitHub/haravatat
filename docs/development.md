# 开发约定与进度

本项目使用 Node.js 24 LTS、TypeScript、React、Fastify 和 PostgreSQL 18（当前稳定系列；PostgreSQL 没有独立 LTS 分支）。依赖使用当前稳定版并通过 package-lock.json 固定；不使用预发布版本。

## 开发约定

- 每次修改代码，同步更新 docs/ 中相关文档，并一起提交。
- 贡献流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)，AI agent 还应阅读 [AGENTS.md](../AGENTS.md)。每次修改前，从最新 origin/main 创建符合 conventional branch 规范的新分支，完成后提交 PR 到 main。遵守 main 与版本标签保护和合并后分支自动清理配置。
- 提交信息使用英文 Conventional Commits。
- CI 安装 Chromium 及系统依赖可能耗时十几分钟，属于正常现象；应观察日志并等待完成，不要仅因耗时较长就取消或重启。
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

credentials.ts 封装仓库凭据的加密存取，密文与 sources 分表，来源 API 不读取或返回密文。数据库新增 auto_sync 字段及 repository_credentials 表，启动迁移保持可重入；既有工作区默认关闭自动同步。工作台仅在进入仓库时调用已有同步 API，服务端没有定时任务。directories.ts 统一目录祖先推导、持久化与文件/目录冲突校验；新表可重入创建且不改写现有文件。目录创建、移动、删除沿用来源行锁，元数据操作不读取大文件内容。FileTree.tsx 处理目录结构、筛选、折叠与目录行操作，入口选择与发布仍由 Dashboard 管理。

## Markdown 解析维护

发布与阅读共享 shared/markdown.ts 的括号数学 tokenizer，并启用 remark-math。新增语法必须验证「原始 Markdown → 发布快照 → React 阅读」全链路，不能仅测试未发布的原文。web/src/markdown-config.ts 提供实际阅读插件配置；高亮和 alert 只作用于展示 AST。依赖使用 KaTeX 0.19.0，并通过 npm override 让 rehype-katex 的排版引擎与导入的 CSS/字体使用同一版本，避免嵌套旧版本引擎造成样式不匹配。

tests/markdown.test.ts 运行真实发布转换和 React 阅读插件，覆盖各类公式定界符、嵌套引用内的多行公式、代码原文、公式资源隔离、嵌套格式高亮、五类 alert、GFM 及不可信公式/HTML。浏览器测试还经过上传和发布接口，检查公式 DOM、字体加载及手机页面宽度。

## 系统字体挂载

scripts/compose-system-fonts.mjs 只使用 Node 内置模块、可选的 fc-list 和 Docker Compose。系统字体目录及 fc-list 文件先解析 realpath，合并重复/子目录后生成只读 bind mount；不将个人路径提交 Git。--print 可检查生成结果，Docker Compose config --quiet 检查合并配置，真实编译应验证宿主机独有字体出现在 PDF 中，并确认挂载为只读。此路径不修改应用编译协议、用户工作区或已发布文章。

当前 WSL/Docker Desktop 实测发现 10 个目录，包含 Windows 系统字体和 Linux/TeX 字体；排除手动 /fonts 后，Noto Sans SC、Noto Serif SC、Go、Consolas、TeX Gyre Termes 五个家族一起编译成功，PDF 确认嵌入全部五种字体，耗时约 1.2 秒。Docker inspect 确认各目录 RW=false；语法、Compose 合并配置和格式检查均通过。

## 文件夹上传回归

浏览器回归通过真实 webkitdirectory 输入选择磁盘上的 notes/ 目录，包含 .git 元数据、二进制文件和中文嵌套文章，检查上传在 10 秒内完成、默认过滤隐藏项，取消勾选则保留 .git。不能用普通多文件 File payload 代替目录选择器，这会遗漏浏览器目录选择带来的路径与隐藏文件行为。

同一浏览器用例验证非法目标路径在发送前被拒绝、连接中断显示中文错误，以及再次选择同一文件夹能成功重试。

tests/uploads.test.ts 通过真实 HTTP 慢速流上传非法路径与后续二进制数据，检查读完整个有界请求后才返回 JSON 400；sources 集成测试确认该错误不会部分写入文件或推进 revision。共享路径校验仍由原有 traversal/配额用例覆盖。

文件夹上传浏览器回归覆盖默认勾选隐藏项过滤、嵌套隐藏目录和隐藏文件、取消过滤后完整保存 .git 元数据、非法目标路径上传前拒绝、网络失败提示及重试。隔离 fixture 不修改用户文件或现有工作区。

虚拟目录回归同时覆盖 API 事务边界和浏览器操作：空目录刷新保留、嵌套新建、文件与目录重命名、递归删除确认、筛选折叠、手机无横向溢出；大文件分块移动仍由 sources.test.ts 验证内容完整。

迁移回归从无 directories 表的旧 schema 升级，验证文件不变，并确认重复迁移保留已有空目录。目录移动回归还验证新前缀使子文件路径超过 500 字符时完整回滚。

## Markdown 导航回归

浏览器用例 markdown-navigation.spec.ts 使用发布转换后的长文与英文、中文命名的重复脚注引用，检查每个返回链接存在对应引用 ID，并实际点击验证滚动回各引用位置；不能仅凭箭头显示或 URL hash 改变认定跳转成功。

remarkToc 在阅读 AST 上为标题分配唯一 ID，并把顶层独占段落的 [TOC] 转为带可访问名称的 nav 与嵌套列表；不向发布快照写入 HTML。目录链接使用纯文本与编码后的本地片段，沿用默认 URL 安全过滤。Article 在内容加载后及 hashchange 时处理片段定位，以支持首次打开和刷新。测试需覆盖发布字符串化后的标记、中文/重复/跳级标题、脚注隔离、代码原文、实际点击及延迟加载后的锚点。
