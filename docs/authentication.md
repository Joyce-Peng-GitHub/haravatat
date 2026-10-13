# GitHub 登录与会话

使用 GitHub OAuth authorization-code 流程，服务端生成随机 state 和 PKCE S256 challenge；state 的哈希与 verifier 只存 PostgreSQL，浏览器通过 HttpOnly Cookie 绑定 state。回调验证匹配、有效期并一次性消耗记录，再交换 token 和查询 /user。以 GitHub 数字 ID 作为用户主键，不依赖可修改的用户名。

应用只需要公开身份，不申请 repo scope。GitHub token 不持久化、不发给浏览器。登录后生成全新随机会话，数据库只保存哈希，有效期 30 天；退出立即删除。Cookie 为 HttpOnly / SameSite=Lax，HTTPS 时设置 Secure。

开发 OAuth 回调填写 http://localhost:5173/auth/github/callback，生产填写 APP_ORIGIN/auth/github/callback；Vite 转发 /auth 到 API。

所有写请求必须携带匹配 APP_ORIGIN 的 Origin 和 X-Haravatat-Request: 1 请求头。无 CORS 授权；JSON 和 multipart 上传都使用相同保护。只读端点不改变用户文件或发布状态。登录入口额外限制请求频率。

API：GET /api/me，GET /auth/github，GET /auth/github/callback，POST /auth/logout。生产必须正确配置 HTTPS，反向代理保留 Cookie 并转发 /api 和 /auth。

验证：集成测试使用 PGlite（PostgreSQL WASM 引擎）执行真实 SQL，覆盖 state 浏览器绑定、PKCE 参数、一次性回调、会话哈希、CSRF 和退出。测试逐文件运行以限制 WASM 内存占用。
