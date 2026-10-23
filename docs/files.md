# 文件来源与虚拟文件系统

每个用户最多 20 个来源，每个来源最多 1000 个文件、50 MiB，单文件最多 8 MiB。文件内容存 PostgreSQL bytea，路径为 POSIX 相对路径，拒绝绝对路径、..、空路径分段、反斜杠、控制字符、冒号和 .git。拒绝文件/目录路径冲突。

目录由文件路径隐式建立，支持保留目录上传，暂不保存空目录。上传覆盖同名草稿；删除目录会删除其下全部草稿；重命名/移动不允许覆盖已有路径。所有修改在来源行锁和事务中完成，失败全部回滚。草稿修改不会自动改变已发布快照。

Git 仓库来源填写完整 HTTPS 克隆地址（任意公网 Git 服务，如 GitHub、GitLab、Codeberg、自建服务，可含端口和多级路径）和精确分支名。兼容 GitHub 的 owner/repository 简写及已有 kind=github 工作区；新来源使用 kind=git。创建后手动同步。支持公开仓库及 token/密码授权的私有仓库，不依赖托管平台 API。

同步通过系统 Git 获取指定 refs/heads/<branch> 或完整 Commit SHA 的浅快照并记录 commit。直接读取该 commit 的 tree/blob，不检出工作目录、不执行 hooks/过滤器。拒绝符号链接、子模块、特殊文件；最多 1000 文件、单文件 8 MiB、总计 50 MiB。失败保留旧快照；并发同步检测 revision 冲突。仓库来源只读，修改需回远端后再次同步。不下载 Git LFS 实体。不支持 SSH、HTTP、内嵌凭据、查询参数、URL 片段或需要跳转的地址，请使用服务提供的最终 HTTPS 克隆地址。

地址经 DNS 解析后必须全部为公网单播 IP。每次同步启动临时 CONNECT 代理，仅允许连接所填主机和端口，固定已校验 IP，覆盖 Git 所有网络请求（包括对象 alternates）；禁用重定向，保持端到端 TLS 证书验证。拒绝本机、私有网段、链路本地、保留地址及 IPv4 映射绕过。每进程同时处理一个同步，忙时返回 503；单条 Git 命令超时 60 秒。Linux 使用 prlimit 限制地址空间 1 GiB、CPU 45 秒、单文件输出 128 MiB、文件描述符 128；临时仓库始终清理。Compose 提供 256 MiB 临时盘。

## 管理 API

- GET /api/sources：自己的来源
- POST /api/sources：kind=upload + name，或 kind=git（兼容 github）+ name + repository + branch
- GET /api/sources/:id：文件大小、当前已发布入口、revision
- DELETE /api/sources/:id：删除来源及其发布文章
- POST /api/sources/:id/upload：multipart，每个文件名使用 encodeURIComponent(相对路径)
- GET /api/sources/:id/file?path=...：下载私有草稿
- PUT /api/sources/:id/file：JSON {path, content}，创建/编辑文本
- DELETE /api/sources/:id/file?path=...：删除文件或目录
- POST /api/sources/:id/move：JSON {from, to}
- POST /api/sources/:id/sync：同步仓库分支或指定 Commit

所有管理 API 要求登录，跨用户请求返回 404，不泄露是否存在。请求体与 CSRF 要求见 authentication.md。

测试覆盖跨用户读写、路径穿越、路径冲突回滚、目录移动删除、仓库同步成功及失败保留旧文件。

## 私有仓库 PAT

POST /api/sources/:id/sync 可带 JSON {token: "...", username: "..."}。token 可为平台 PAT 或 HTTPS 密码；用户名按服务要求填写，缺省 GitLab.com 使用 oauth2，其他服务使用 x-access-token。token 不含控制字符，用户名不含冒号或控制字符。认证只保留在当次请求与 Git 子进程内存，不写 URL、命令行参数、磁盘、数据库、日志或 API 响应。通过作用于目标 URL 的 HTTP Basic Authorization 发送；清空系统/全局 Git 配置，不调用凭据助手。GitHub PAT 推荐目标仓库 Contents: read 权限。

私有仓库内容仍属于用户私有草稿；用户点击发布的入口和文章引用的图片将公开，目前没有文章权限控制。仓库可见性不自动成为博客文章的访问权限。

参考：[Git fetch](https://git-scm.com/docs/git-fetch)、[Git HTTP 配置](https://git-scm.com/docs/git-config)。

### 固定 Commit

新建仓库可提供可选 commit（完整 40 或 64 位十六进制 SHA，不接受缩写）；不填时使用 branch（默认 main）。target_commit 保存所选目标，commit_sha 保存上次实际同步结果。同步请求可带 commit 切换目标，省略沿用目标、空字符串恢复跟随分支；成功后在同一事务中更新文件与目标，失败保留原目标和快照。可在同步时选择已不在当前分支上的旧提交，但远端需允许按该 SHA 获取对象；不存在或服务不允许获取的 SHA 会明确失败。发布仍需用户再次勾选确认，切换提交不会自动替换已发布文章。

浏览器在同步成功/切换来源后清空用户名与 token，仅将 Commit 目标保留用于下次同步。界面及浏览器测试覆盖 GitLab 多级 HTTPS 地址、私有认证输入、固定 Commit、切换 Commit、恢复分支和手机布局。
