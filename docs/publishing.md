# 勾选发布与阅读

POST /api/sources/:id/publish 接收 {entries: [{path, title?}]}，最多 30 个入口。这个列表替换整个来源的发布选择；空列表取消全部发布。Markdown 支持 .md/.markdown，Typst 支持 .typ，大小写不敏感。

发布先读取一致的来源快照，在事务外编译，再取得行锁检查 revision。全部入口成功才一起替换文章；任意入口编译失败或草稿并发变化返回错误，保留上次成功发布。发布本身推进 revision，避免并发发布互相覆盖。未改变的入口保持相同文章 UUID。标题可在发布界面自定义；Markdown 默认为首个一级标题，Typst 默认为文件名。

Markdown 使用 GFM 语法，React 渲染时禁止原始 HTML，链接限制安全协议。解析 AST 处理图片、链接、引用式定义；文章仅公开实际引用的 PNG/JPEG/GIF/WebP/AVIF 图片快照，草稿、模板、数据文件不通过公开路由暴露。相对文章链接仅指向同次选中的入口；缺失或不支持的本地链接置空。不提供 YAML front matter、数学 Markdown 扩展或 SVG 直接嵌入。

Typst 在独立内部编译服务生成 PDF；前端使用 PDF.js canvas + 文字层逐页竖向渲染，阅读页面使用浏览器文档滚动，无内嵌 PDF viewer 和工具栏。PDF 保持固定排版，在窄屏缩放到内容宽度；并非文字重排。

公开 API：GET /api/posts?page=1&author=可选GitHub用户名，GET /api/posts/:id，GET /api/posts/:id/pdf，GET /api/posts/:id/assets/:path。

## 编译隔离

编译服务不持有数据库、GitHub 或应用会话凭据。入口与全部文件复制到一次性临时目录，Typst --root 限制到该来源；使用 prlimit 限制地址空间 4 GiB、CPU 25 秒、输出 32 MiB、文件描述符 128，墙钟超时 30 秒，单服务同时编译一个任务，繁忙返回错误。失败诊断只返回工作区内路径，不泄露临时宿主路径；完成后清理全部临时文件。

生产需运行提供的独立编译容器，不向公网暴露 /compile。容器使用无特权用户、只读系统盘、tmpfs、cap_drop、no-new-privileges、内存/CPU/PID 限制和仅内部网络。不能把同一进程方案视为完整 OS 沙箱。

Typst 包缓存通过 TYPST_PACKAGE_CACHE 提供，默认为一次性缓存；生产内部网络禁止自动联网下载，请预先准备包缓存并按部署文档挂载。缓存缺少精确版本时，错误可能显示 failed to download package / Dns Failed；应通过独立联网辅助容器准备该版本及依赖，原编译服务继续离线、只读。源文件相对 import、字体和本地图片均可使用。服务器源码不支持通过文件访问应用密钥。

测试覆盖 Markdown 图片快照与私有依赖隔离、跨入口链接、PDF 接口、编译失败回滚、并发修改拒绝、稳定文章 UUID、取消发布；真实 Typst CLI 测试包含跨目录 include、多页公式 PDF 和越界 read 拒绝。

上传工作区内的 TTF/OTF 字体通过 --font-path 加入本次编译字体搜索；不会写入或影响其他用户的字体目录。

内部编译协议使用流式 multipart 二进制文件传输，X-Typst-Entry 为 encodeURIComponent 编码的相对入口路径；编译服务复用上传的 1 GiB / 1024 文件校验。无需 Base64/JSON 大字符串，避免大文件的编码膨胀与 JavaScript 单字符串大小限制。接收/远程请求超时 300 秒，Typst 实际执行仍限 30 秒。Compose 编译容器提供 2 GiB tmpfs、6 GiB 内存上限，覆盖输入副本和编译开销；PDF 输出仍限制 32 MiB。应用和编译镜像须一起更新以匹配内部协议。
