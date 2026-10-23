# 勾选发布与阅读

POST /api/sources/:id/publish 接收 {entries: [{path, title?}]}，最多 30 个入口。这个列表替换整个来源的发布选择；空列表取消全部发布。Markdown 支持 .md/.markdown，Typst 支持 .typ，大小写不敏感。

发布先读取一致的来源快照，在事务外编译，再取得行锁检查 revision。全部入口成功才一起替换文章；任意入口编译失败或草稿并发变化返回错误，保留上次成功发布。发布本身推进 revision，避免并发发布互相覆盖。未改变的入口保持相同文章 UUID。标题可在发布界面自定义；Markdown 默认为首个一级标题，Typst 默认为文件名。

Markdown 使用 GFM 语法，React 渲染时禁止原始 HTML，链接限制安全协议。解析 AST 处理图片、链接、引用式定义；文章仅公开实际引用的 PNG/JPEG/GIF/WebP/AVIF 图片快照，草稿、模板、数据文件不通过公开路由暴露。相对文章链接仅指向同次选中的入口；缺失或不支持的本地链接置空。不提供 YAML front matter 或 SVG 直接嵌入。

数学公式通过 remark-math、共享的括号公式 tokenizer 与 rehype-katex 排版。支持 $...$、$$...$$（同一行或多行）、\(...\)、\[...\] 及 math 标记的围栏代码块。后端发布与前端使用相同解析规则，发布时保留 TeX 命令、下标和括号公式的显示模式；公式内的 Markdown 图片/链接标记不会作为资源引用解析。普通代码块与行内代码中的公式标记保持原文。KaTeX CSS/字体随前端构建，不依赖第三方 CDN；输出包含 MathML，trust=false、maxExpand=1000、maxSize=20，不启用用户 HTML 或外部资源指令。非法/不支持的公式显示错误原文，不使整个阅读页崩溃。

GFM 已提供 ~~删除线~~、表格、任务列表和脚注；阅读器增加 remark-flexible-markers 的 ==高亮== 与 GitHub 风格五类 alert block，语法示例见 markdown.md。高亮、alert 只在展示 AST 上变换，发布快照保留其 Markdown 标记；原始 HTML 仍不执行。

Typst 在独立内部编译服务生成 PDF；前端使用 PDF.js canvas + 文字层逐页竖向渲染，阅读页面使用浏览器文档滚动，无内嵌 PDF viewer 和工具栏。PDF 保持固定排版，在窄屏缩放到内容宽度；并非文字重排。

公开 API：GET /api/posts?page=1&author=可选GitHub用户名，GET /api/posts/:id，GET /api/posts/:id/pdf，GET /api/posts/:id/assets/:path。

## 编译隔离

编译服务不持有数据库、GitHub 或应用会话凭据。入口与全部文件复制到一次性临时目录，Typst --root 限制到该来源；使用 prlimit 限制地址空间 4 GiB、CPU 25 秒、输出 32 MiB、文件描述符 128，墙钟超时 30 秒，单服务同时编译一个任务，繁忙返回错误。失败诊断只返回工作区内路径，不泄露临时宿主路径；完成后清理全部临时文件。

生产需运行提供的独立编译容器，不向公网暴露 /compile。容器使用无特权用户、只读系统盘、tmpfs、cap_drop、no-new-privileges、内存/CPU/PID 限制和仅内部网络。不能把同一进程方案视为完整 OS 沙箱。

Typst 包缓存通过 TYPST_PACKAGE_CACHE 提供，默认为一次性缓存；生产内部网络禁止自动联网下载，请预先准备包缓存并按部署文档挂载。缓存缺少精确版本时，错误可能显示 failed to download package / Dns Failed；应通过独立联网辅助容器准备该版本及依赖，原编译服务继续离线、只读。源文件相对 import、字体和本地图片均可使用。服务器源码不支持通过文件访问应用密钥。

测试覆盖 Markdown 图片快照与私有依赖隔离、跨入口链接、PDF 接口、编译失败回滚、并发修改拒绝、稳定文章 UUID、取消发布；真实 Typst CLI 测试包含跨目录 include、多页公式 PDF 和越界 read 拒绝。

上传工作区内的 TTF/OTF/TTC 字体通过 --font-path 加入本次编译字体搜索；不会写入或影响其他用户的字体目录。编译服务还支持管理员配置的 TYPST_FONT_PATHS（Linux 用冒号分隔），Compose 默认只读挂载 fonts/ 到 /fonts。使用 scripts/compose-system-fonts.mjs 启动可自动发现并只读挂载系统字体，每次编译重新扫描，新增字体无需逐个复制；详见 deployment.md。字体家族名必须精确匹配，Noto Sans SC 与 Noto Sans CJK SC 是不同名字。

Typst 0.15.1 对 unknown font family 只输出 warning，退出码仍为 0，默认使用后备字体。本服务将这类诊断视为发布失败，返回源文件位置及缺失家族名，保留已发布版本，避免无提示地改变排版。其他编译警告不自动升级为错误；存在字体但缺少某个字形时，Typst 自身的字形回退规则仍适用。

内部编译协议使用流式 multipart 二进制文件传输，X-Typst-Entry 为 encodeURIComponent 编码的相对入口路径；编译服务复用上传的 1 GiB / 1024 文件校验。无需 Base64/JSON 大字符串，避免大文件的编码膨胀与 JavaScript 单字符串大小限制。接收/远程请求超时 300 秒，Typst 实际执行仍限 30 秒。Compose 编译容器提供 2 GiB tmpfs、6 GiB 内存上限，覆盖输入副本和编译开销；PDF 输出仍限制 32 MiB。应用和编译镜像须一起更新以匹配内部协议。
