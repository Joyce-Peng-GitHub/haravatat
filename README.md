# Haravatat

通过 GitHub 登录的多用户 Typst / Markdown 博客。

- GitHub 仓库 + 指定分支，手动同步；私有仓库使用 PAT。
- PostgreSQL 虚拟文件系统：目录上传、下载、编辑、删除、移动。
- 勾选入口发布，Typst 编译为 PDF，Markdown 使用 GFM。
- PDF 页面竖向连续排列，无工具栏，支持文字选择与链接。
- 用户工作区隔离；发布失败保留线上版本。

使用 Node.js 24 LTS、React、Fastify、PostgreSQL 18、Typst 0.15.1 和 PDF.js。依赖精确版本见 package-lock.json。

```bash
npm ci
cp .env.example .env
# 填写 PostgreSQL 与 GitHub OAuth 配置
npm run compiler
# 另一个终端
npm run dev
```

生产使用 `docker compose up --build -d`，需要 HTTPS 反向代理和 GitHub OAuth App。

自动使用服务器系统字体：本地预览运行 `node scripts/compose-system-fonts.mjs up --build -d --wait`；生产加 `--production`。脚本自动发现并只读挂载字体目录，无需逐个复制字体，后续启动也使用该命令。详情见部署文档。

文档：[部署](docs/deployment.md) · [配置](docs/configuration.md) · [登录](docs/authentication.md) · [文件管理](docs/files.md) · [发布](docs/publishing.md) · [界面](docs/interface.md) · [开发进度](docs/development.md)。示例文件位于 examples/。

上传工作区支持持久保存空文件夹，在文件树中创建、重命名、移动和递归删除文件夹。上传默认忽略任意层级以 `.` 开头的文件和文件夹，可取消勾选以完整上传。
