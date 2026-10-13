# 文件来源与虚拟文件系统

每个用户最多 20 个来源，每个来源最多 1000 个文件、50 MiB，单文件最多 8 MiB。文件内容存 PostgreSQL bytea，路径为 POSIX 相对路径，拒绝绝对路径、..、空路径分段、反斜杠、控制字符、冒号和 .git。拒绝文件/目录路径冲突。

目录由文件路径隐式建立，支持保留目录上传，暂不保存空目录。上传覆盖同名草稿；删除目录会删除其下全部草稿；重命名/移动不允许覆盖已有路径。所有修改在来源行锁和事务中完成，失败全部回滚。草稿修改不会自动改变已发布快照。

GitHub 来源填写 owner/repository（也可提供 https://github.com/owner/repository）和精确分支名。创建后需手动同步。支持公开仓库和 PAT 授权的私有仓库。下载前通过 GitHub API 将分支解析到 commit SHA，再下载固定 SHA 的 ZIP，以保持一次同步内部一致。仅访问 GitHub 固定主机，无任意 URL 抓取。拒绝符号链接、特殊文件、超大 ZIP/解压文件。失败保留旧快照；并发同步检测 revision 冲突。仓库来源只读，修改需回 GitHub 后再次同步。不下载 Git LFS 实体、不递归拉取 submodule。

公开仓库下载无需 repo OAuth 权限；API 使用未认证额度（可能共享服务器 IP），额度耗尽会明确报错，未来可增加 GitHub App 授权。私有仓库可在同步时输入 PAT。

## 管理 API

- GET /api/sources：自己的来源
- POST /api/sources：kind=upload + name，或 kind=github + name + repository + branch
- GET /api/sources/:id：文件大小、当前已发布入口、revision
- DELETE /api/sources/:id：删除来源及其发布文章
- POST /api/sources/:id/upload：multipart，每个文件名使用 encodeURIComponent(相对路径)
- GET /api/sources/:id/file?path=...：下载私有草稿
- PUT /api/sources/:id/file：JSON {path, content}，创建/编辑文本
- DELETE /api/sources/:id/file?path=...：删除文件或目录
- POST /api/sources/:id/move：JSON {from, to}
- POST /api/sources/:id/sync：同步指定仓库分支

所有管理 API 要求登录，跨用户请求返回 404，不泄露是否存在。请求体与 CSRF 要求见 authentication.md。

测试覆盖跨用户读写、路径穿越、路径冲突回滚、目录移动删除、仓库同步成功及失败保留旧文件。

## 私有仓库 PAT

POST /api/sources/:id/sync 可带 JSON {token: "..."}。token 只保留在当次请求内存，不存数据库、不写日志、不返回浏览器；同步成功/切换来源后清空界面输入。fine-grained PAT 仅授予目标仓库 Contents: read，classic PAT 需要 repo 权限（范围更广），组织仓库可能需要批准/SSO。使用最新 GitHub REST API 2026-03-10。

带 token 的请求先使用 Authorization 访问 GitHub API，将 zipball 的 302 地址严格校验为 https://codeload.github.com，再下载签名地址；不会向重定向目标转发 Authorization。拒绝非允许主机、非 HTTPS、内嵌凭据和额外端口。GitHub 返回权限/额度错误时不暴露 token。

私有仓库内容仍属于用户私有草稿；用户点击发布的入口和文章引用的图片将公开，目前没有文章权限控制。GitHub 仓库的可见性不自动成为博客文章的访问权限。

参考：[GitHub 仓库 ZIP API 与 token 权限](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip)。

PAT 测试覆盖请求头转发边界、分支含斜杠、恶意下载重定向拒绝、目录 ZIP 和符号链接拒绝，以及管理 API 不返回 token。
