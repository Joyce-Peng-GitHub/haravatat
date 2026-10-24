# 依赖安全检查（2026-10-24）

分支：`codex/security-dependencies-2026-10`。

## 发现与修复

- 本机原有 Node 为 24.18.1；项目此前只要求 24.x。将 `.nvmrc`、CI、三个 Docker 基础镜像和 engines 最低版本统一为 24.22.1，覆盖 10 月安全更新（Brotli 内存破坏、TLS 主机名验证、DNS、Undici 等）。验证使用下载到 `/tmp` 的官方二进制，SHA-256 与官方发布页一致；未修改本机 nvm 安装或既有运行服务。
- eMudhra 事件涉及弱密钥中间证书。Node 安全版更新内置信任库；Git 使用系统 CA，因此两个运行镜像额外禁用 `emSign ECC Root CA - G3`，重新生成 CA 链。构建脚本同时检查 Node 和系统信任库，残留该根时使构建失败。可能影响仍使用该证书链的远端，应迁移证书链，不能关闭 TLS 校验。
- npm audit 发现 Fastify 5.12.5 的 GHSA-389g-gv7q-r4x8（低危），更新至 5.12.7。在线复查零已知漏洞；这不代表不存在未公开漏洞。
- PostgreSQL 浮动标签 18 改为 18.6（CI 与 Compose），明确最低安全基线。无法仅从浮动标签判断旧运行实例实际版本。
- Typst 镜像为 0.15.1。本项目未发现 PHP/Python 服务依赖；本次没有对宿主机或所有系统包做完整漏洞扫描。

## 直接依赖清单

版本来自 package.json，并检查 npm registry 的 latest 标签。保留非安全必需的普通更新；`@types/node` 跟随 Node 24，避免直接升级到 Node 26 类型。

| 依赖                     | 当前版本 | registry latest | 用途      |
| ------------------------ | -------- | --------------- | --------- |
| @fastify/cookie          | 11.1.3   | 11.1.3          | 运行      |
| @fastify/helmet          | 13.1.2   | 13.2.0          | 运行      |
| @fastify/multipart       | 10.1.3   | 10.1.6          | 运行      |
| @fastify/rate-limit      | 11.2.1   | 11.2.1          | 运行      |
| @fastify/static          | 10.1.6   | 10.1.7          | 运行      |
| fastify                  | 5.12.7   | 5.12.7          | 运行      |
| ipaddr.js                | 2.5.0    | 2.5.0           | 运行      |
| katex                    | 0.19.0   | 0.19.0          | 运行      |
| mdast-util-from-markdown | 2.0.3    | 2.1.0           | 运行      |
| mdast-util-math          | 3.0.0    | 3.0.0           | 运行      |
| mdast-util-to-markdown   | 2.1.2    | 2.2.0           | 运行      |
| micromark-util-types     | 2.0.2    | 2.0.3           | 运行      |
| pdfjs-dist               | 6.4.299  | 6.4.299         | 运行      |
| pg                       | 8.23.1   | 8.23.1          | 运行      |
| react                    | 19.3.0   | 19.3.1          | 运行      |
| react-dom                | 19.3.0   | 19.3.1          | 运行      |
| react-markdown           | 10.1.0   | 10.1.0          | 运行      |
| react-router-dom         | 7.18.4   | 7.18.4          | 运行      |
| rehype-katex             | 7.0.1    | 7.0.1           | 运行      |
| remark-flexible-markers  | 1.3.6    | 1.3.6           | 运行      |
| remark-gfm               | 4.0.1    | 4.0.1           | 运行      |
| remark-math              | 6.0.0    | 6.0.0           | 运行      |
| remark-parse             | 11.0.0   | 11.0.0          | 运行      |
| remark-stringify         | 11.0.0   | 11.0.0          | 运行      |
| tsx                      | 4.23.15  | 4.23.15         | 运行      |
| unified                  | 11.0.5   | 11.0.5          | 运行      |
| unist-util-visit         | 5.1.0    | 5.1.0           | 运行      |
| zod                      | 4.6.7    | 4.6.7           | 运行      |
| @electric-sql/pglite     | 0.5.9    | 0.5.11          | 开发/测试 |
| @playwright/test         | 1.64.0   | 1.64.1          | 开发/测试 |
| @types/node              | 24.19.2  | 26.6.5          | 开发/测试 |
| @types/pg                | 8.23.1   | 8.23.1          | 开发/测试 |
| @types/react             | 19.3.0   | 19.3.0          | 开发/测试 |
| @types/react-dom         | 19.3.0   | 19.3.0          | 开发/测试 |
| @vitejs/plugin-react     | 6.1.2    | 6.1.2           | 开发/测试 |
| concurrently             | 10.0.6   | 10.0.6          | 开发/测试 |
| prettier                 | 3.9.10   | 3.9.10          | 开发/测试 |
| typescript               | 7.0.2    | 7.0.2           | 开发/测试 |
| vite                     | 8.3.4    | 8.3.5           | 开发/测试 |

## 验证结果

- Node 24.22.1 下 TypeScript 检查和 Vite 构建通过；格式检查、git diff --check 通过。
- 26 项测试通过，开发和生产模式浏览器测试各 7 项通过。
- application 与 compiler 镜像构建通过，两个镜像的 Node / 系统 CA 检查通过。
- Compose 配置校验通过。未替换现有 PostgreSQL 实例验证数据库升级。
- 最初沙箱测试因子进程和监听端口权限失败，放行后全部通过；浏览器测试使用独立 API 端口避开现有服务。

## 部署生效

本次只准备和验证变更，未替换已有部署或数据库。部署时先备份数据库，并核对 PostgreSQL 18.6 发布说明中的扩展、逻辑复制和索引注意事项，再执行：

```sh
nvm install
nvm use
npm ci
docker compose pull db
docker compose build --pull app compiler
docker compose up -d
```

确认应用和编译容器的 `node --version` 为 v24.22.1，并在数据库执行 `SHOW server_version`。以后继续更新安全补丁，固定版本不会自动获得后续修复。宿主机直接运行 Git 时，其 CA 库仍需由宿主机维护者更新；容器内措施不会修改宿主机信任库。

## 官方依据

- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/blog/release/v24.22.1/
- https://blog.mozilla.org/security/2026/10/20/protecting-firefox-users-following-the-compromise-of-emudhra-intermediate-certificates/
- https://bugzilla.mozilla.org/show_bug.cgi?id=2083449
- https://github.com/fastify/fastify/security/advisories/GHSA-389g-gv7q-r4x8
- https://www.postgresql.org/support/security/18/
- https://www.postgresql.org/docs/release/18.6/
