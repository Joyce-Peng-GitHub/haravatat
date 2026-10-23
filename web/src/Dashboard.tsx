import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from './App';
import { FileTree } from './FileTree';
import { api, type Source, type Workspace, errorMessage } from './api';
import { MAX_SOURCE_BYTES, MAX_FILES } from '../../shared/limits';
const isEntry = (path: string) => /\.(typ|md|markdown)$/i.test(path);
const isText = (path: string) =>
  /\.(typ|md|markdown|txt|json|csv|yaml|yml|toml|bib|css)$/i.test(path);
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1048576).toFixed(1)} MiB`
        : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
export function Dashboard() {
  const { user, loading, configured } = useAuth();
  const [params, setParams] = useSearchParams(),
    sourceId = params.get('source');
  const [sources, setSources] = useState<Source[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [selected, setSelected] = useState<Record<string, string>>({});
  const [actionBusy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [fetching, setFetching] = useState(false),
    [filter, setFilter] = useState(''),
    [prefix, setPrefix] = useState('');
  const [automaticSyncing, setAutomaticSyncing] = useState(false);
  const busy = actionBusy || (automaticSyncing ? '自动同步' : '');
  const [repoToken, setRepoToken] = useState('');
  const [repoUsername, setRepoUsername] = useState('');
  const [repoCommit, setRepoCommit] = useState('');
  const [creating, setCreating] = useState(false),
    [kind, setKind] = useState<'upload' | 'git'>('upload');
  const [editor, setEditor] = useState<{ path: string; content: string; original?: string } | null>(
      null,
    ),
    [move, setMove] = useState<{ from: string; to: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null);
  const loadSources = async () => {
    const result = await api<{ sources: Source[] }>('/api/sources');
    setSources(result.sources);
  };
  const loadWorkspace = async (id: string) => {
    const result = await api<Workspace>(`/api/sources/${id}`);
    setWorkspace(result);
    setRepoCommit(result.source.target_commit || '');
    setSelected(
      Object.fromEntries(
        result.posts
          .filter((post) => result.files.some((f) => f.path === post.entry_path))
          .map((p) => [p.entry_path, p.title]),
      ),
    );
  };
  useEffect(() => {
    if (!user) {
      setSources([]);
      setWorkspace(null);
      return;
    }
    const controller = new AbortController();
    api<{ sources: Source[] }>('/api/sources', { signal: controller.signal })
      .then((result) => setSources(result.sources))
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [user]);
  useEffect(() => {
    setWorkspace(null);
    setEditor(null);
    setMove(null);
    setError('');
    setSuccess('');
    setFilter('');
    setRepoToken('');
    setRepoUsername('');
    setRepoCommit('');
    setSelected({});
    setAutomaticSyncing(false);
    if (!sourceId || !user) return;
    const controller = new AbortController();
    setFetching(true);
    api<Workspace>(`/api/sources/${sourceId}`, { signal: controller.signal })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.source.kind !== 'upload' && result.source.auto_sync) {
          setAutomaticSyncing(true);
          try {
            const synced = await api<{ skipped?: boolean; unchanged?: boolean }>(
              `/api/sources/${sourceId}/sync`,
              {
                method: 'POST',
                body: { automatic: true },
                signal: controller.signal,
              },
            );
            result = await api<Workspace>(`/api/sources/${sourceId}`, {
              signal: controller.signal,
            });
            const listing = await api<{ sources: Source[] }>('/api/sources', {
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            setSources(listing.sources);
            if (!synced.skipped)
              setSuccess(
                synced.unchanged
                  ? '自动同步完成，仓库没有新提交。'
                  : '已自动同步仓库。重新发布后线上文章才会更新。',
              );
          } catch (error) {
            if (!controller.signal.aborted)
              setError(`自动同步未完成：${errorMessage(error)}。已保留上次快照，可手动重试。`);
          } finally {
            if (!controller.signal.aborted) setAutomaticSyncing(false);
          }
        }
        if (controller.signal.aborted) return;
        setWorkspace(result);
        setRepoCommit(result.source.target_commit || '');
        setSelected(
          Object.fromEntries(
            result.posts
              .filter((p) => result.files.some((f) => f.path === p.entry_path))
              .map((p) => [p.entry_path, p.title]),
          ),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false);
      });
    return () => controller.abort();
  }, [sourceId, user]);
  const run = async (label: string, action: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy('');
    }
  };
  const createSource = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void run(
      '创建',
      async () => {
        const result = await api<{ source: Source }>('/api/sources', {
          method: 'POST',
          body: {
            kind,
            name: String(values.get('name')),
            ...(kind === 'git'
              ? {
                  repository: String(values.get('repository')),
                  branch: String(values.get('branch')),
                  commit: String(values.get('commit') || '') || undefined,
                }
              : {}),
          },
        });
        await loadSources();
        setCreating(false);
        setParams({ source: result.source.id });
      },
      kind === 'git' ? '仓库来源已创建，点击同步以获取文件。' : '工作区已创建，可以上传文件了。',
    );
  };
  const upload = (files: FileList | null) => {
    if (!files?.length || !sourceId) return;
    const list = Array.from(files),
      base = prefix.trim().replace(/\/$/, '');
    void run(
      '上传',
      async () => {
        const nextFiles = new Map(workspace?.files.map((file) => [file.path, file.size]));
        for (const file of list)
          nextFiles.set(
            [base, file.webkitRelativePath || file.name].filter(Boolean).join('/'),
            file.size,
          );
        if (nextFiles.size > MAX_FILES) throw new Error('每个工作区最多 1024 个文件。');
        if ([...nextFiles.values()].reduce((sum, bytes) => sum + bytes, 0) > MAX_SOURCE_BYTES)
          throw new Error('工作区总大小最多 1 GiB。');
        const body = new FormData();
        for (const file of list)
          body.append(
            'files',
            file,
            encodeURIComponent(
              [base, file.webkitRelativePath || file.name].filter(Boolean).join('/'),
            ),
          );
        await api(`/api/sources/${sourceId}/upload`, { method: 'POST', body });
        await loadWorkspace(sourceId);
        await loadSources();
      },
      '文件已上传。勾选入口后发布，线上文章才会更新。',
    );
    if (fileInput.current) fileInput.current.value = '';
    if (folderInput.current) folderInput.current.value = '';
  };
  const publish = () => {
    if (!sourceId) return;
    if (
      !Object.keys(selected).length &&
      workspace?.posts.length &&
      !window.confirm('这会取消此工作区全部文章的发布，继续吗？')
    )
      return;
    void run(
      '发布',
      async () => {
        await api(`/api/sources/${sourceId}/publish`, {
          method: 'POST',
          body: {
            entries: Object.entries(selected).map(([path, title]) => ({
              path,
              ...(title.trim() ? { title: title.trim() } : {}),
            })),
          },
        });
        await loadWorkspace(sourceId);
        await loadSources();
      },
      Object.keys(selected).length
        ? '发布成功，文章已出现在首页。'
        : '已取消此工作区全部文章的发布。',
    );
  };
  const openEditor = (path: string) => {
    if (!sourceId) return;
    void run(
      '读取文件',
      async () => {
        const response = await fetch(
          `/api/sources/${sourceId}/file?path=${encodeURIComponent(path)}`,
        );
        if (!response.ok) throw new Error('读取文件失败');
        setEditor({ path, original: path, content: await response.text() });
      },
      '',
    );
  };
  if (loading)
    return (
      <main className="page empty" role="status">
        正在连接工作台…
      </main>
    );
  if (!user)
    return (
      <main className="page login-page">
        <p className="eyebrow">YOUR WRITING SPACE</p>
        <h1>
          你的文字，
          <br />
          <em>从这里出发。</em>
        </h1>
        <p>
          通过 GitHub 登录，管理自己的仓库与文件，
          <br />
          选择想分享的内容，发布为 Typst 或 Markdown 文章。
        </p>
        {configured ? (
          <a className="button" href="/auth/github">
            通过 GitHub 登录 ↗
          </a>
        ) : (
          <div className="notice">GitHub 登录尚未配置，请联系站点管理员。</div>
        )}
        <Link className="back-link" to="/">
          先阅读文章 →
        </Link>
      </main>
    );
  const source = workspace?.source;
  const missing =
    workspace?.posts.filter(
      (post) => !workspace.files.some((file) => file.path === post.entry_path),
    ) ?? [];
  return (
    <main className="page dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">YOUR WRITING SPACE</p>
          <h1>
            我的工作台<span className="muted"> / {user.login}</span>
          </h1>
        </div>
        <button className="button" disabled={Boolean(busy)} onClick={() => setCreating(true)}>
          ＋ 新建来源
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <strong>操作未完成</strong>
          <pre>{error}</pre>
        </div>
      )}
      {success && (
        <div className="notice success" role="status">
          {success}
        </div>
      )}
      {busy && (
        <div className="notice" role="status">
          正在{busy}…{busy === '发布' && ' Typst 编译可能需要一些时间，请保留当前页面。'}
        </div>
      )}
      <div className="workspace-layout">
        <aside className="source-sidebar">
          <div className="sidebar-label">
            内容来源 <span>{sources.length}/20</span>
          </div>
          {!sources.length && (
            <p className="sidebar-empty">添加一个仓库或工作区，开始整理你的文章。</p>
          )}
          {sources.map((item) => (
            <button
              disabled={Boolean(busy)}
              key={item.id}
              className={`source-item ${sourceId === item.id ? 'active' : ''}`}
              onClick={() => setParams({ source: item.id })}
            >
              <span className="source-icon" aria-hidden="true">
                {item.kind !== 'upload' ? '↗' : '▤'}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.kind !== 'upload'
                    ? `${item.repository} · ${item.target_commit ? item.target_commit.slice(0, 7) : item.branch}`
                    : '上传工作区'}
                  <br />
                  {item.file_count ?? 0} 文件 · {item.post_count ?? 0} 已发布
                </small>
              </span>
            </button>
          ))}
          <div className="sidebar-note">
            <strong>两种格式，一个空间</strong>
            <p>勾选 .typ 作为编译入口，或选中 Markdown 文章。其他文件作为依赖保留。</p>
          </div>
        </aside>
        <section className="workspace-main" aria-busy={Boolean(busy || fetching)}>
          {fetching ? (
            <div className="empty" role="status">
              正在读取工作区…
            </div>
          ) : !source ? (
            <div className="empty workspace-placeholder">
              <span className="empty-symbol">▤</span>
              <h2>为思考留一个空间</h2>
              <p>从左侧选择来源，或新建工作区。</p>
              <button className="button secondary" onClick={() => setCreating(true)}>
                添加内容来源
              </button>
            </div>
          ) : (
            <>
              <div className="workspace-top">
                <div>
                  <span className="eyebrow">
                    {source.kind !== 'upload' ? 'GIT REPOSITORY' : 'VIRTUAL WORKSPACE'}
                  </span>
                  <h2>{source.name}</h2>
                  <p className="muted">
                    {source.kind !== 'upload' ? (
                      <>
                        {source.repository} / {source.branch}{' '}
                        {source.commit_sha && <code>· {source.commit_sha.slice(0, 7)}</code>}
                      </>
                    ) : (
                      '上传文字与依赖文件，保留你的目录结构。'
                    )}
                  </p>
                </div>
                {source.kind !== 'upload' && (
                  <button
                    className="button secondary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(
                        '同步',
                        async () => {
                          await api(`/api/sources/${source.id}/sync`, {
                            method: 'POST',
                            body: {
                              token: repoToken || undefined,
                              username: repoUsername || undefined,
                              commit: repoCommit.trim(),
                            },
                          });
                          setRepoToken('');
                          setRepoUsername('');
                          await loadWorkspace(source.id);
                          await loadSources();
                        },
                        '已同步仓库。重新发布后线上文章才会更新。',
                      )
                    }
                  >
                    ↻ 同步仓库
                  </button>
                )}
              </div>
              {source.kind !== 'upload' && (
                <div className="repository-token">
                  <div className="repository-fields">
                    <label>
                      Commit SHA（可选）
                      <input
                        aria-label="同步 Commit SHA"
                        placeholder="留空跟随分支，或填写完整 Commit SHA"
                        value={repoCommit}
                        maxLength={64}
                        disabled={Boolean(busy)}
                        onChange={(event) => setRepoCommit(event.target.value)}
                      />
                    </label>
                    <label>
                      仓库用户名（可选）
                      <input
                        aria-label="仓库用户名"
                        placeholder="按 Git 服务要求填写"
                        value={repoUsername}
                        maxLength={200}
                        autoComplete="off"
                        disabled={Boolean(busy)}
                        onChange={(event) => setRepoUsername(event.target.value)}
                      />
                    </label>
                    <label>
                      私有仓库访问 token
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label="私有仓库访问 token"
                        placeholder={
                          source.has_credentials
                            ? '留空使用已保存凭据'
                            : 'Token 或 HTTPS 密码（公开仓库可留空）'
                        }
                        value={repoToken}
                        disabled={Boolean(busy)}
                        onChange={(event) => setRepoToken(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="repository-settings">
                    <div className="credential-status">
                      <span>
                        {source.has_credentials ? '服务器已保存加密凭据' : '未保存仓库凭据'}
                      </span>
                      <div className="tool-actions">
                        <button
                          disabled={
                            Boolean(busy) || !repoToken || !workspace.credentialStorageAvailable
                          }
                          onClick={() =>
                            void run(
                              '保存凭据',
                              async () => {
                                await api(`/api/sources/${source.id}/credentials`, {
                                  method: 'PUT',
                                  body: { token: repoToken, username: repoUsername || undefined },
                                });
                                setRepoToken('');
                                setRepoUsername('');
                                setWorkspace(await api<Workspace>(`/api/sources/${source.id}`));
                                await loadSources();
                              },
                              '凭据已加密保存，后续同步无需重复输入。',
                            )
                          }
                        >
                          {source.has_credentials ? '替换已保存凭据' : '保存凭据'}
                        </button>
                        {source.has_credentials && (
                          <button
                            className="danger-text"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void run(
                                '删除凭据',
                                async () => {
                                  await api(`/api/sources/${source.id}/credentials`, {
                                    method: 'DELETE',
                                  });
                                  setRepoToken('');
                                  setRepoUsername('');
                                  setWorkspace(await api<Workspace>(`/api/sources/${source.id}`));
                                  await loadSources();
                                },
                                '已删除保存的凭据，并关闭自动同步。',
                              )
                            }
                          >
                            删除保存的凭据
                          </button>
                        )}
                      </div>
                    </div>
                    <label className="auto-sync-setting">
                      <input
                        type="checkbox"
                        checked={source.auto_sync}
                        disabled={Boolean(busy)}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setWorkspace({ ...workspace, source: { ...source, auto_sync: enabled } });
                          void run(
                            '保存同步设置',
                            async () => {
                              try {
                                await api(`/api/sources/${source.id}/settings`, {
                                  method: 'PATCH',
                                  body: { autoSync: enabled },
                                });
                              } catch (error) {
                                setWorkspace((current) =>
                                  current?.source.id === source.id
                                    ? {
                                        ...current,
                                        source: { ...current.source, auto_sync: source.auto_sync },
                                      }
                                    : current,
                                );
                                throw error;
                              }
                              setWorkspace(await api<Workspace>(`/api/sources/${source.id}`));
                              await loadSources();
                            },
                            enabled ? '已开启：下次打开此工作台时自动同步。' : '已关闭自动同步。',
                          );
                        }}
                      />
                      打开此工作台时自动同步
                    </label>
                    {source.synced_at && (
                      <small>上次同步：{new Date(source.synced_at).toLocaleString('zh-CN')}</small>
                    )}
                  </div>
                  <p>
                    Commit 留空则同步分支最新版本。token 留空时复用已保存凭据，填写新 token
                    只用于本次同步；点击「保存凭据」才会持久保存。自动同步仅更新草稿，勾选发布的内容将公开。
                  </p>
                  {!workspace.credentialStorageAvailable && (
                    <p>管理员尚未配置凭据存储；仍可输入 token 进行单次同步。</p>
                  )}
                </div>
              )}
              {source.kind === 'upload' && (
                <div className="upload-panel">
                  <div>
                    <strong>把文件带到这里</strong>
                    <p>Typst、Markdown，以及文章需要的图片、模板和数据。</p>
                  </div>
                  <div className="upload-actions">
                    <input
                      aria-label="上传目标目录"
                      placeholder="目标目录（可选）"
                      value={prefix}
                      onChange={(event) => setPrefix(event.target.value)}
                      disabled={Boolean(busy)}
                    />
                    <button
                      className="button secondary small"
                      disabled={Boolean(busy)}
                      onClick={() => fileInput.current?.click()}
                    >
                      上传文件
                    </button>
                    <button
                      className="button secondary small"
                      disabled={Boolean(busy)}
                      onClick={() => folderInput.current?.click()}
                    >
                      上传文件夹
                    </button>
                    <input
                      type="file"
                      multiple
                      hidden
                      ref={fileInput}
                      onChange={(event) => upload(event.target.files)}
                    />
                    <input
                      type="file"
                      multiple
                      hidden
                      ref={(element) => {
                        folderInput.current = element;
                        element?.setAttribute('webkitdirectory', '');
                      }}
                      onChange={(event) => upload(event.target.files)}
                    />
                  </div>
                  <small>工作区 1 GiB / 1024 文件 · 单文件无独立大小限制 · 空目录不保存</small>
                </div>
              )}
              <div className="file-tools">
                <label className="search-input">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="筛选文件"
                    placeholder="查找文件路径…"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </label>
                {source.kind === 'upload' && (
                  <div className="tool-actions">
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => setEditor({ path: '', content: '' })}
                    >
                      ＋ 新建文本
                    </button>
                    <button disabled={Boolean(busy)} onClick={() => setMove({ from: '', to: '' })}>
                      移动文件 / 目录
                    </button>
                  </div>
                )}
              </div>
              <div className="file-list">
                <div className="file-list-header">
                  <span>选择入口 / 文件路径</span>
                  <span>大小</span>
                  <span>操作</span>
                </div>
                {!workspace.files.length ? (
                  <div className="empty">
                    <p>
                      {source.kind !== 'upload'
                        ? '点击「同步仓库」获取仓库文件。'
                        : '还没有文件，上传或新建一篇文章吧。'}
                    </p>
                  </div>
                ) : (
                  <FileTree
                    key={source.id}
                    files={workspace.files}
                    filter={filter}
                    renderFile={(file, depth) => (
                      <div
                        className="file-row"
                        data-path={file.path}
                        style={{ paddingInlineStart: 17 + Math.min(depth, 6) * 14 }}
                      >
                        <div className="file-name">
                          {isEntry(file.path) ? (
                            <input
                              type="checkbox"
                              aria-label={`发布 ${file.path}`}
                              checked={file.path in selected}
                              disabled={Boolean(busy)}
                              onChange={(event) =>
                                setSelected((old) => {
                                  const next = { ...old };
                                  if (event.target.checked) next[file.path] = file.title ?? '';
                                  else delete next[file.path];
                                  return next;
                                })
                              }
                            />
                          ) : (
                            <span className="dependency-dot" aria-label="依赖文件">
                              ·
                            </span>
                          )}
                          <div>
                            <span className="file-path" title={file.path}>
                              {file.path.split('/').at(-1)}
                            </span>
                            {file.post_id && (
                              <span className="file-state">
                                {file.source_revision === source.revision ? '已发布' : '草稿有更新'}
                              </span>
                            )}
                            {file.path in selected && (
                              <input
                                className="title-input"
                                aria-label={`${file.path} 的文章标题`}
                                placeholder="文章标题（留空自动提取）"
                                value={selected[file.path]}
                                disabled={Boolean(busy)}
                                maxLength={200}
                                onChange={(event) =>
                                  setSelected((old) => ({
                                    ...old,
                                    [file.path]: event.target.value,
                                  }))
                                }
                              />
                            )}
                          </div>
                        </div>
                        <span className="file-size">{size(file.size)}</span>
                        <div className="file-actions">
                          {file.post_id && (
                            <Link title="阅读已发布版本" to={`/p/${file.post_id}`}>
                              阅读
                            </Link>
                          )}
                          <a
                            title="下载草稿文件"
                            href={`/api/sources/${source.id}/file?path=${encodeURIComponent(file.path)}`}
                          >
                            下载
                          </a>
                          {source.kind === 'upload' && (
                            <>
                              {isText(file.path) && (
                                <button
                                  disabled={Boolean(busy)}
                                  onClick={() => openEditor(file.path)}
                                >
                                  编辑
                                </button>
                              )}
                              <button
                                className="danger-text"
                                disabled={Boolean(busy)}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `删除草稿 ${file.path}？已发布文章会保留到下次发布。`,
                                    )
                                  )
                                    void run(
                                      '删除',
                                      async () => {
                                        await api(
                                          `/api/sources/${source.id}/file?path=${encodeURIComponent(file.path)}`,
                                          { method: 'DELETE' },
                                        );
                                        await loadWorkspace(source.id);
                                        await loadSources();
                                      },
                                      '草稿已删除，线上文章尚未改变。',
                                    );
                                }}
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  />
                )}
              </div>
              {missing.length > 0 && (
                <div className="notice">
                  {missing.length} 篇已发布文章的入口已从草稿删除，下次发布会将其下架。
                </div>
              )}
              <div className="publish-panel">
                <div>
                  <strong>
                    已选择 {Object.keys(selected).length} 个入口{' '}
                    <span className="muted">/ 最多 30 个</span>
                  </strong>
                  <p>发布会更新勾选的文章，并下架未勾选的文章。失败保留旧版本。</p>
                </div>
                <button
                  className="button"
                  disabled={Boolean(busy) || Object.keys(selected).length > 30}
                  onClick={publish}
                >
                  发布所选文章 <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="workspace-bottom">
                <span>修改草稿后，需再次发布。</span>
                <button
                  className="text-button danger-text"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除整个来源「${source.name}」及全部文件、已发布文章？此操作不可恢复。`,
                      )
                    )
                      void run(
                        '删除来源',
                        async () => {
                          await api(`/api/sources/${source.id}`, { method: 'DELETE' });
                          setParams({});
                          await loadSources();
                        },
                        '来源已删除。',
                      );
                  }}
                >
                  删除来源
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      {creating && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <button
              className="modal-close"
              aria-label="关闭"
              disabled={Boolean(busy)}
              onClick={() => setCreating(false)}
            >
              ×
            </button>
            <p className="eyebrow">A NEW BEGINNING</p>
            <h2 id="create-title">添加内容来源</h2>
            <div className="segmented">
              <button
                className={kind === 'upload' ? 'active' : ''}
                onClick={() => setKind('upload')}
              >
                上传工作区
              </button>
              <button className={kind === 'git' ? 'active' : ''} onClick={() => setKind('git')}>
                Git 仓库
              </button>
            </div>
            <form onSubmit={createSource}>
              <label>
                来源名称
                <input required name="name" maxLength={120} placeholder="例如：我的数学笔记" />
              </label>
              {kind === 'git' && (
                <>
                  <label>
                    仓库地址
                    <input
                      required
                      name="repository"
                      placeholder="https://git.example.com/group/repository.git"
                      maxLength={2048}
                    />
                  </label>
                  <label>
                    分支名
                    <input required name="branch" defaultValue="main" maxLength={200} />
                  </label>
                  <label>
                    Commit SHA（可选）
                    <input
                      name="commit"
                      maxLength={64}
                      pattern="[a-fA-F0-9]{40}|[a-fA-F0-9]{64}"
                      placeholder="完整 SHA；留空使用分支最新提交"
                    />
                  </label>
                  <p className="muted">
                    支持任意公网 HTTPS Git 仓库，也可填写 GitHub 的 owner/repository
                    简写。创建后手动同步，私有仓库可输入用户名与 token。文章发布后公开。
                  </p>
                </>
              )}
              <button className="button" disabled={Boolean(busy)} type="submit">
                创建来源 →
              </button>
            </form>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      {editor && sourceId && (
        <div className="modal-backdrop">
          <section
            className="modal editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <button
              className="modal-close"
              aria-label="关闭"
              disabled={Boolean(busy)}
              onClick={() => setEditor(null)}
            >
              ×
            </button>
            <h2 id="edit-title">{editor.original ? '编辑草稿' : '新建文本文件'}</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  '保存',
                  async () => {
                    await api(`/api/sources/${sourceId}/file`, {
                      method: 'PUT',
                      body: { path: editor.path, content: editor.content },
                    });
                    setEditor(null);
                    await loadWorkspace(sourceId);
                    await loadSources();
                  },
                  '草稿已保存，发布后线上版本才会更新。',
                );
              }}
            >
              <label>
                相对文件路径
                <input
                  required
                  placeholder="notes/hello.typ"
                  disabled={Boolean(editor.original) || Boolean(busy)}
                  value={editor.path}
                  onChange={(event) => setEditor({ ...editor, path: event.target.value })}
                />
              </label>
              <label>
                文件内容
                <textarea
                  required={false}
                  value={editor.content}
                  spellCheck={false}
                  disabled={Boolean(busy)}
                  onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                />
              </label>
              <button className="button" disabled={Boolean(busy)}>
                保存草稿
              </button>
            </form>
            {error && (
              <pre className="notice error" role="alert">
                {error}
              </pre>
            )}
          </section>
        </div>
      )}
      {move && sourceId && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="move-title">
            <button
              className="modal-close"
              aria-label="关闭"
              disabled={Boolean(busy)}
              onClick={() => setMove(null)}
            >
              ×
            </button>
            <h2 id="move-title">移动文件或目录</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  '移动',
                  async () => {
                    await api(`/api/sources/${sourceId}/move`, { method: 'POST', body: move });
                    setMove(null);
                    await loadWorkspace(sourceId);
                  },
                  '路径已更新。请检查入口中的相对引用并重新发布。',
                );
              }}
            >
              <label>
                原路径
                <input
                  required
                  value={move.from}
                  placeholder="notes"
                  onChange={(event) => setMove({ ...move, from: event.target.value })}
                />
              </label>
              <label>
                新路径
                <input
                  required
                  value={move.to}
                  placeholder="articles/notes"
                  onChange={(event) => setMove({ ...move, to: event.target.value })}
                />
              </label>
              <button className="button" disabled={Boolean(busy)}>
                移动
              </button>
            </form>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
