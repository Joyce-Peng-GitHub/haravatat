# GitHub 登录与会话

使用 GitHub OAuth authorization-code 流程，服务端生成随机 state 和 PKCE S256 challenge；state 的哈希与 verifier 只存 PostgreSQL，浏览器通过 HttpOnly Cookie 绑定 state。回调验证匹配、有效期并一次性消耗记录，再交换 token 和查询 /user。以 GitHub 数字 ID 作为用户主键，不依赖可修改的用户名。

应用只需要公开身份，不申请 repo scope。GitHub token 不持久化、不发给浏览器。登录后生成全新随机会话，数据库只保存哈希，有效期 30 天；退出立即删除。Cookie 为 HttpOnly / SameSite=Lax，HTTPS 时设置 Secure。

开发 OAuth 回调填写 http://localhost:5173/auth/github/callback，生产填写 APP_ORIGIN/auth/github/callback；Vite 转发 /auth 到 API。

所有写请求必须携带匹配 APP_ORIGIN 的 Origin 和 X-Haravatat-Request: 1 请求头。无 CORS 授权；JSON 和 multipart 上传都使用相同保护。只读端点不改变用户文件或发布状态。登录入口额外限制请求频率。

API：GET /api/me，GET /auth/github，GET /auth/github/callback，POST /auth/logout。生产必须正确配置 HTTPS，反向代理保留 Cookie 并转发 /api 和 /auth。

验证：集成测试使用 PGlite（PostgreSQL WASM 引擎）执行真实 SQL，覆盖 state 浏览器绑定、PKCE 参数、一次性回调、会话哈希、CSRF 和退出。测试逐文件运行以限制 WASM 内存占用。

私有仓库通过同步时输入 PAT 访问，也可由用户显式保存为服务器端加密凭据；GitHub 登录 token 和仓库 PAT 用途分离，登录不申请 repo scope。未来增加文章权限时可在公开 posts 查询与媒体端点统一加入权限校验，不能只限制阅读页。

持久化 PAT 使用独立 CREDENTIAL_ENCRYPTION_KEY 和 AES-256-GCM，用户名与 token 一起加密，绑定工作区、所属用户及仓库地址；只向所有者返回是否已保存的状态。同步时才解密并传入 Git 子进程内存。凭据管理接口与文件管理使用相同会话、CSRF、用户归属校验，详见 files.md。GitHub OAuth 的登录 token 仍不持久化，不作为仓库 PAT 使用。
