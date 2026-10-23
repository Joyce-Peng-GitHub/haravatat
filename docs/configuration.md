# 配置

Node.js 使用 24 LTS。复制 .env.example 为 .env，填写 GitHub OAuth App 的 Client ID / Secret。密码和 .env 不提交到 Git。

| 配置                                    | 用途                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| DATABASE_URL                            | PostgreSQL 连接字符串                                       |
| APP_ORIGIN                              | 浏览器访问站点的完整 origin；开发默认 http://localhost:5173 |
| GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET | GitHub OAuth App 凭据                                       |
| COMPILER_URL                            | 独立 Typst 编译服务内部地址                                 |
| PORT                                    | API 监听端口，默认 3000                                     |
| NODE_ENV                                | development / test / production                             |

APP_ORIGIN 不允许路径、查询串或内嵌凭据，生产环境必须使用 HTTPS。Cookie 的 Secure 标记由 APP_ORIGIN 决定。

Docker Compose 另需 POSTGRES_PASSWORD（URL 安全字符），不会使用开发 .env 中 DATABASE_URL；APP_ORIGIN 必须 HTTPS。编译服务支持 COMPILER_HOST / COMPILER_PORT、TYPST_BIN、TYPST_PACKAGE_CACHE，这些仅配置到编译容器或开发编译进程，不能通过用户请求指定。详细见 deployment.md。

Compose 中 GitHub 凭据可留空，以便先验证公开阅读、数据库和编译服务；这时无法登录或管理工作区。获得真实 OAuth App 凭据后填写 .env，再执行相同 Compose 文件的 up -d 以重新创建应用容器。

可选 GIT_DNS_OVER_HTTPS_URL 用于返回 Fake-IP 的网络：设置受信任的 HTTPS DNS JSON 端点（例如 https://cloudflare-dns.com/dns-query），同时查询 A/AAAA，仅接受公网地址。默认使用系统 DNS，无自动回退，不向仓库提供的 DNS 服务发请求。DoH 只传域名，不传仓库路径、用户名或 token；端点由部署管理员配置，拒绝非 HTTPS、内嵌凭据和 URL 片段。Compose 可在 .env 中设置该变量，留空使用系统 DNS；compose.local.yaml 针对当前桌面代理环境启用 Cloudflare。

可选 CREDENTIAL_ENCRYPTION_KEY 用于持久化仓库用户名/PAT：必须为 32 随机字节的 64 位十六进制编码。生产应通过部署密钥系统注入，Compose 从未提交的 .env 传给 app；密钥需跨重启保持稳定并与数据库分开备份。缺省时禁用凭据保存，单次输入 token 的手动同步仍可用；格式不合法时启动失败。加密格式和密钥丢失后的处理见 authentication.md、deployment.md。
