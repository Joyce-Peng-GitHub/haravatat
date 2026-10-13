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
- 草稿和发布快照存 PostgreSQL bytea；按用户限制 20 个来源、每来源 50 MiB/1000 文件，最多 30 个发布入口，PDF 最多 32 MiB。全站注册人数没有管理配额，公开开放前需按实际服务预算增加运营控制。
- GitHub LFS/submodule 和 Markdown front matter、数学扩展暂不支持。
- PDF 在手机上按宽度缩放，文字不重排；长文档使用按需 canvas 渲染。
- 本地测试验证了业务与真实 Typst/PDF 渲染；Docker 镜像仍需在可运行 Docker 的环境实测，真实 GitHub OAuth 需自己的 OAuth App 凭据。Compose config 已通过无 daemon 的语法与变量校验。真实 GitHub 仓库下载已验证固定 commit 与带认证 ZIP 重定向链路；未认证共享 IP 额度耗尽时可提供 PAT。

CI 使用 PostgreSQL 18 service，通过 TEST_DATABASE_URL 让同一组集成/浏览器测试使用真实 pg 驱动。每个测试 fixture 创建独立 schema，完成后清理；本地未设置该变量时使用 PGlite。仅向专用测试数据库提供该变量，需拥有 CREATE SCHEMA 权限，不能使用生产库。
