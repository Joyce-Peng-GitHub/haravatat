# 文件来源与虚拟文件系统

每个用户最多 20 个来源，每个来源最多 1024 个文件，总大小最多 1 GiB（1,073,741,824 字节），不设独立的单文件大小限制；单个文件可以占满工作区总容量。文件内容存 PostgreSQL bytea，路径为 POSIX 相对路径，拒绝绝对路径、..、空路径分段、反斜杠、控制字符、冒号和 .git。拒绝文件/目录路径冲突。

目录由文件路径隐式建立，支持保留目录上传，暂不保存空目录。上传覆盖同名草稿；删除目录会删除其下全部草稿；重命名/移动不允许覆盖已有路径。所有修改在来源行锁和事务中完成，失败全部回滚。草稿修改不会自动改变已发布快照。

Git 仓库来源填写完整 HTTPS 克隆地址（任意公网 Git 服务，如 GitHub、GitLab、Codeberg、自建服务，可含端口和多级路径）和精确分支名。兼容 GitHub 的 owner/repository 简写及已有 kind=github 工作区；新来源使用 kind=git。创建后手动同步。支持公开仓库及 token/密码授权的私有仓库，不依赖托管平台 API。

同步通过系统 Git 获取指定 refs/heads/<branch> 或完整 Commit SHA 的浅快照并记录 commit。直接读取该 commit 的 tree/blob，不检出工作目录、不执行 hooks/过滤器。拒绝符号链接、子模块、特殊文件；最多 1024 文件、总计 1 GiB，不设独立单文件大小限制。失败保留旧快照；并发同步检测 revision 冲突。仓库来源只读，修改需回远端后再次同步。不下载 Git LFS 实体。不支持 SSH、HTTP、内嵌凭据、查询参数、URL 片段或需要跳转的地址，请使用服务提供的最终 HTTPS 克隆地址。

地址经 DNS 解析后必须全部为公网单播 IP。每次同步启动临时 CONNECT 代理，仅允许连接所填主机和端口，固定已校验 IP，覆盖 Git 所有网络请求（包括对象 alternates）；禁用重定向，保持端到端 TLS 证书验证。拒绝本机、私有网段、链路本地、保留地址及 IPv4 映射绕过。每进程同时处理一个同步，忙时返回 503；单条 Git 命令超时 300 秒。Linux 使用 prlimit 限制地址空间 4 GiB、CPU 120 秒、临时 pack 文件输出 2 GiB、文件描述符 128；临时仓库始终清理。Compose 为应用提供 3 GiB 临时盘（包括 Git 对象和 pack），内存上限 8 GiB。

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

## 大文件与配额

上传、文本编辑、Git 快照和编译入口使用同一套 1 GiB / 1024 文件配额，前后端常量来自 shared/limits.ts。文件数和大小均按整个草稿工作区计算，包括未勾选发布的依赖；同名覆盖只计算替换后的内容。刚好达到上限允许，超过任一上限返回 413，错误明确提示总大小或文件数，事务保留原内容和 revision。

multipart 按流累计字节，超出总容量立即停止；协议中单个 part 上限也设为整个工作区容量，不附加较小的单文件限制。文本编辑 JSON 允许转义开销；浏览器和 Node 的字符串/内存能力仍影响超大文本在线编辑，二进制文件使用上传/下载。上传请求接收超时 300 秒，反向代理也需允许至少 1 GiB 加 multipart 开销的请求体和足够的上传时间。

大于 4 MiB 的文件存入 file_chunks，单块 4 MiB，files.byte_size 保存原始字节数；小文件及迁移前记录继续使用 files.content，byte_size 为 NULL。这样单个 1 GiB 文件不依赖一个接近 PostgreSQL 字段/协议极限的 bytea。初始化通过可重入 ALTER 添加字段和级联子表，不改写旧文件。读写由 storage.ts 统一处理，目录移动、删除、下载、Git 同步和编译快照均支持分块文件；删除工作区/用户同时清理分块。所有分块写入与配额检查在同一事务内完成。

测试覆盖刚好 1 GiB / 1024 个文件及分别超额、超过旧单文件限制的上传与 Git blob、分块下载和目录移动删除、覆盖计数、超额上传回滚，以及超过旧总大小限制的远程编译。边界配额测试复用 Buffer 来累计真实长度，避免为每次测试分配 1 GiB。
