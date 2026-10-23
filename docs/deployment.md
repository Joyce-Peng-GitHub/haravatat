# 本地开发与部署

## 本地开发

环境要求：Node.js 24 LTS、PostgreSQL 18、Typst 0.15.1、Linux 的 prlimit（util-linux）。数据库不使用 SQLite。Typst/React/PostgreSQL 没有与 Node.js 相同的 LTS 发布标签，使用最新稳定系列与锁定依赖。

```bash
npm ci
cp .env.example .env
# 填写 DATABASE_URL、APP_ORIGIN、GitHub OAuth 凭据
npm run compiler
# 另一个终端
npm run dev
```

打开 http://localhost:5173，OAuth App 的回调配置为 http://localhost:5173/auth/github/callback。数据库需预先创建；API 启动时在事务中初始化 schema。开发编译服务只绑定 127.0.0.1，务必不要开放到公网。本地开发无容器沙箱，只运行自己信任的源文件。

生产前验证：npm run format:check、npm run build、npm test、npm run test:e2e（首次需 npx playwright install chromium）。单元/集成测试用 PGlite 执行真实 PostgreSQL SQL；浏览器 fixture 不需要生产数据库、OAuth 密钥。真实编译测试需要 Typst 和 prlimit。

## Docker Compose

```bash
cp .env.example .env
# APP_ORIGIN=https://blog.example.com
# 设置 POSTGRES_PASSWORD（建议仅使用 URL 安全字符）、GitHub OAuth 凭据
# 忽略 .env 中开发用 DATABASE_URL；Compose 根据 POSTGRES_PASSWORD 构造内部连接串

docker compose up --build -d
```

镜像：Node.js 24（当前 LTS）/ Debian 13，PostgreSQL 18 当前稳定系列，Typst 0.15.1 固定编译器。生产 APP_ORIGIN 必须 HTTPS；服务器端口仅绑定 127.0.0.1:3000，需 Nginx/Caddy 等 HTTPS 反向代理。OAuth 回调使用 https://blog.example.com/auth/github/callback。不要单独开放 db 或 compiler 端口。

应用访问公网用于 OAuth/仓库下载；数据库和编译服务仅连接各自内部网络。编译容器无数据库与 GitHub 密钥、无公网网络，具有只读系统盘、临时目录和进程限制。CJK 和 DejaVu 字体随容器安装，Typst 内嵌字体也可用。Typst 编译源文件访问范围受 --root 限制。

### Typst 包

预先把所需 @preview 包缓存放入 typst_packages Docker volume，目录结构与 Typst CLI 的 --package-cache-path 一致（preview/name/version）。编译容器以只读形式挂载，离线运行。可用受信任的、联网的临时 Typst 容器编译自己准备的导入样例，指定 --package-cache-path /packages 并挂载该 volume；准备完成后再发布依赖这些包的文章。默认 Compose 项目名 haravatat，对应 volume 名 haravatat_typst_packages。自定义项目名时需使用对应 volume 名。

```bash
# deps.typ 包含你要预缓存的 import，且文件是受信任的
# 示例：#import "@preview/ctheorems:2.0.0": *
docker run --rm --user 0 -v "$PWD:/work:ro" -v haravatat_typst_packages:/packages ghcr.io/typst/typst:0.15.1 compile --root /work --package-cache-path /packages /work/deps.typ /tmp/deps.pdf
```

数据库 volume 位于 PostgreSQL 18 推荐的 /var/lib/postgresql；升级大版本前使用 pg_dump/pg_restore 或 pg_upgrade，不能直接替换旧 volume 数据。备份数据库即可包含虚拟文件与已发布 PDF/图片；编译包缓存可再生成。

## 已知边界

- 默认公开博客；私有仓库可使用 PAT 同步，但发布的内容公开。文章权限与 webhook 自动同步未实现。
- 应用是单节点部署；编译服务同时接受一个任务，繁忙时用户稍后重试。多入口串行编译。
- 草稿和发布快照存 PostgreSQL bytea；按用户限制 20 个来源、每来源 1 GiB/1024 文件，单文件无独立大小限制，最多 30 个发布入口，PDF 最多 32 MiB。全站注册人数没有管理配额，公开开放前需按实际服务预算增加运营控制。
- Git LFS/submodule 和 Markdown front matter、数学扩展暂不支持。
- PDF 在手机上按宽度缩放，文字不重排；长文档使用按需 canvas 渲染。
- 已在 Docker Desktop 实测镜像构建与三服务启动，真实 GitHub OAuth 仍需自己的 OAuth App 凭据。Compose config 已通过无 daemon 的语法与变量校验。仓库同步使用系统 Git HTTPS 协议，运行镜像包含 Git、CA 证书与 prlimit；无需平台 API 额度。

CI 使用 PostgreSQL 18 service，通过 TEST_DATABASE_URL 让同一组集成/浏览器测试使用真实 pg 驱动。每个测试 fixture 创建独立 schema，完成后清理；本地未设置该变量时使用 PGlite。仅向专用测试数据库提供该变量，需拥有 CREATE SCHEMA 权限，不能使用生产库。

## Docker Desktop 本地预览

未配置 GitHub OAuth 时也可启动服务，登录端点明确返回未配置状态。创建仅本机使用的 .env，设置随机 POSTGRES_PASSWORD；GitHub 凭据可以留空，然后运行：

```bash
docker compose -f compose.yaml -f compose.local.yaml up --build -d --wait
```

打开 http://localhost:3000。compose.local.yaml 将应用切换为 development 模式以允许本地 HTTP，并为本地网络配置 HTTPS DNS，使用构建后的静态页面；保留数据库/编译网络隔离和只读容器限制。生产继续单独使用 compose.yaml 和 HTTPS APP_ORIGIN。配置登录时使用回调 http://localhost:3000/auth/github/callback。

.env 不提交到 Git。停止服务使用相同 Compose 文件执行 stop；重新启动使用 start。不要使用 down -v，除非确实要删除数据库。

### Docker 实测记录（2026-10-23）

- Docker Desktop 4.89.0 / Engine 29.7.2：app、db、compiler 均为 healthy。
- 宿主机直连 http://127.0.0.1:3000/api/health 返回 {"ok":true}，首页 HTTP 200；未配置 OAuth 时 /api/me 返回 loginConfigured=false。
- 通过应用 API 写入临时工作区、发布 Markdown 与 Typst，验证真实 PostgreSQL 存储和远程编译服务。中文 CJK 字体、跨目录 include、显式分页编译成功，PDF 为 15120 bytes。
- 将入口改为越界 read 后发布返回 422，已发布 PDF 字节保持一致。临时用户及其工作区、会话、文章已级联清理，预览数据库不保留测试内容。
- 运行镜像的 npm audit --omit=dev 报告 Fastify 5.12.5 的一项 low 告警（GHSA-389g-gv7q-r4x8，header propertyNames 大小写校验）；本次未修改依赖锁，后续依赖升级时处理。

本地直接运行 API 时也需安装 git、CA 证书与 Linux util-linux（prlimit）。仓库 URL 仅允许公网 HTTPS；自建服务需有公开可解析域名及有效 TLS 证书。应用 /tmp 临时盘为 3 GiB，Git 获取的临时 pack 也计入该限额。

当前 Docker Desktop 网络使用 Fake-IP DNS（198.18.0.0/15、fdfe::），直接解析会被公网地址校验拒绝。compose.local.yaml 显式启用 Cloudflare HTTPS DNS JSON 获取真实地址，再通过固定 IP 隧道获取仓库；生产默认仍使用系统 DNS。该选项不放行任何私有或保留地址。参考 [Cloudflare DNS JSON API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。

镜像构建复用同一份 npm ci 依赖，再 prune 开发依赖供应用/编译服务使用。Git 的 Debian 安装包通过 HTTPS 下载（DEBIAN_MIRROR 构建参数默认 Debian 官方源；本地预览针对当前网络使用 USTC 镜像，APT 继续校验 Debian 仓库签名）；系统 CA 包安装前临时使用 Node 自带 Mozilla CA 根验证证书，安装后删除临时 CA 文件。

### HTTPS Git 与 Commit 验证（2026-10-23）

- 12 项后端测试通过；开发页面与生产静态页面各 2 项浏览器测试通过，覆盖 GitLab 多级 URL、用户名/token 输入、Commit 创建/切换/恢复分支及手机布局。构建、类型与格式检查通过。
- 系统 Git 实际获取 GitHub octocat/Hello-World 的 master，commit 为 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d，并按该 SHA 重复获取相同快照。
- 调整桌面网络后，通过运行中的应用 API 获取 GitLab gitlab-examples/nodejs 的 master（17 文件，892a1f16725e56cc3a2cb0d677be42935c8fc262），再固定到该 SHA。不存在的 SHA 返回 502，原 revision、文件和目标 Commit 保持不变；回环地址同步返回 400。
- 同一容器通过隔离编译服务生成 9947-byte PDF；app、db、compiler 均为 healthy。API 测试使用临时身份和会话，结束后已级联清理所有测试数据。
- 未使用真实私有仓库凭据；用户名/token 的传递与不持久化通过 API 测试验证。桌面网络曾出现 DNS/连接错误，调整网络后本轮完整检查通过。遇到此类错误应先检查网络，不能通过放行私有地址解决。

### 工作区容量

每工作区总容量为 1 GiB、最多 1024 文件，含全部未发布的依赖。大文件以 4 MiB PostgreSQL bytea 分块保存，现有数据通过启动迁移兼容读取；数据库备份必须包含 file_chunks 表。内部编译传输改为流式 multipart，请同时重建 app 和 compiler。

Compose 将 app 内存上限设为 8 GiB、tmpfs 3 GiB，compiler 内存上限 6 GiB、tmpfs 2 GiB；tmpfs 使用量计入容器内存。它们是资源上限而非预分配，宿主机需为并发的大工作区处理留足内存。Git 单命令墙钟上限增至 300 秒、地址空间 4 GiB、CPU 120 秒和临时 pack 文件 2 GiB；Typst 输出仍限 32 MiB，运行时间仍限 30 秒。

HTTPS 反向代理须允许至少 1 GiB 加 multipart 头部开销（例如 Nginx client_max_body_size 1100m），并相应配置上传/上游等待时间；应用接收请求上限 300 秒。Git 传输数据/pack 可能大于最终选定 commit 的文件总量，仍受临时盘与进程资源限制。

### 1 GiB 容量实测（2026-10-23）

- 14 项后端测试通过，开发页面和生产静态页面各 2 项浏览器测试通过；构建、类型、格式检查通过。补充旧 schema 迁移测试，重复初始化后原内联文件仍可读取。
- Docker Desktop 的真实 PostgreSQL / 应用 API 接收单个 1,073,741,824-byte 文件，文件列表大小正确，下载后的 SHA-256 与上传内容一致。
- 满容量工作区再上传 1 字节返回 413，文件列表与 revision 保持不变；将文件替换为二进制依赖加 Typst 入口、合计恰好 1 GiB 后，成功经独立编译容器发布 9939-byte PDF。
- 本次实测使用临时用户和会话，结束后已级联清理草稿、分块和文章。已有用户数据保留，app、db、compiler 均为 healthy。
