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
