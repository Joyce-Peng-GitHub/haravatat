import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { markdownPlugins, htmlPlugins } from './markdown-config';
import 'katex/dist/katex.min.css';
import { api, type Post, date, errorMessage } from './api';
const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
export function Home() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1),
    author = params.get('author') || '';
  const [posts, setPosts] = useState<Post[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<{ posts: Post[]; hasMore: boolean }>(
      `/api/posts?page=${page}${author ? `&author=${encodeURIComponent(author)}` : ''}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setPosts(result.posts);
        setMore(result.hasMore);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, author]);
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">A PLACE FOR THOUGHTFUL WORDS</p>
          <h1>
            思考，值得
            <br />
            <em>被好好呈现。</em>
          </h1>
          <p className="hero-description">
            从一行文字到一页公式。用 Markdown 记录，
            <br className="desktop-break" />用 Typst 表达，在这里分享你的知识。
          </p>
          <Link className="button" to="/dashboard">
            开始写作 <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="hero-paper" aria-hidden="true">
          <div className="paper-top">
            NOTES ON KNOWLEDGE <span>01</span>
          </div>
          <h2>
            文字的秩序
            <br />
            思考的自由
          </h2>
          <p>Every idea deserves a place.</p>
          <div className="paper-equation">
            ∫<sub>0</sub>
            <sup>∞</sup> e<sup>−x²</sup> dx = <span>√π / 2</span>
          </div>
          <div className="paper-rule" />
          <div className="paper-lines">
            <i />
            <i />
            <i />
          </div>
          <span className="paper-stamp">
            TYPST
            <br />& MD
          </span>
        </div>
      </section>
      <section className="journal">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE JOURNAL</p>
            <h2>{author ? `${author} 的文章` : '最新文章'}</h2>
          </div>
          <span className="muted">
            公开的文字，共享的灵感
            {author && (
              <>
                {' '}
                · <Link to="/">查看全部</Link>
              </>
            )}
          </span>
        </div>
        {loading ? (
          <div className="empty" role="status">
            正在读取文章…
          </div>
        ) : error ? (
          <div className="notice error" role="alert">
            {error}
          </div>
        ) : !posts.length ? (
          <div className="empty empty-journal">
            <span className="empty-symbol">✳</span>
            <h3>故事从第一篇开始</h3>
            <p>连接你的仓库，或上传文件，把思考分享给世界。</p>
            <Link to="/dashboard">前往工作台 →</Link>
          </div>
        ) : (
          <div className="post-grid">
            {posts.map((post, index) => (
              <article className="post-card" key={post.id}>
                <div className="card-top">
                  <span className={`format-badge ${post.format}`}>
                    {post.format === 'typst' ? 'TYPST' : 'MARKDOWN'}
                  </span>
                  <span className="card-number">
                    {String((page - 1) * 24 + index + 1).padStart(2, '0')}
                  </span>
                </div>
                <Link className="post-title" to={`/p/${post.id}`}>
                  <h3>{post.title}</h3>
                  <span aria-hidden="true">↗</span>
                </Link>
                <p className="source-label">{post.source_name}</p>
                <div className="card-bottom">
                  <Link to={`/?author=${encodeURIComponent(post.login)}`} className="author">
                    <img src={post.avatar_url} alt="" />
                    {post.name}
                  </Link>
                  <time dateTime={post.published_at}>{date(post.published_at)}</time>
                </div>
              </article>
            ))}
          </div>
        )}
        {(page > 1 || more) && (
          <div className="pagination">
            <button
              disabled={page <= 1}
              onClick={() => setParams({ ...(author ? { author } : {}), page: String(page - 1) })}
            >
              ← 上一页
            </button>
            <span>第 {page} 页</span>
            <button
              disabled={!more}
              onClick={() => setParams({ ...(author ? { author } : {}), page: String(page + 1) })}
            >
              下一页 →
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
export function Article() {
  const { id } = useParams(),
    [post, setPost] = useState<Post | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setPost(null);
    setError('');
    window.scrollTo(0, 0);
    api<{ post: Post }>(`/api/posts/${id}`, { signal: controller.signal })
      .then((result) => {
        setPost(result.post);
        document.title = `${result.post.title} · Haravatat`;
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => {
      controller.abort();
      document.title = 'Haravatat · 知识与文字';
    };
  }, [id]);
  return (
    <main className="article-page">
      <Link className="back-link" to="/">
        ← 返回文章
      </Link>
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : !post ? (
        <div className="empty" role="status">
          正在打开文章…
        </div>
      ) : (
        <>
          <header className="article-heading">
            <span className={`format-badge ${post.format}`}>
              {post.format === 'typst' ? 'TYPST' : 'MARKDOWN'}
            </span>
            <h1>{post.title}</h1>
            <div className="article-meta">
              <Link className="author" to={`/?author=${encodeURIComponent(post.login)}`}>
                <img src={post.avatar_url} alt="" />
                {post.name}
              </Link>
              <time dateTime={post.published_at}>{date(post.published_at)}</time>
              <span>{post.source_name}</span>
            </div>
          </header>
          {post.format === 'typst' ? (
            <Suspense
              fallback={
                <div className="empty" role="status">
                  正在加载阅读器…
                </div>
              }
            >
              <PdfReader url={`/api/posts/${post.id}/pdf`} />
            </Suspense>
          ) : (
            <article className="markdown-body">
              <Markdown
                remarkPlugins={markdownPlugins}
                rehypePlugins={htmlPlugins}
                skipHtml
                urlTransform={(url) => {
                  const safe = defaultUrlTransform(url);
                  if (/^\/\//.test(safe)) return '';
                  return safe;
                }}
                components={{
                  a: ({ children, href }) =>
                    href ? (
                      <a href={href} rel="noopener noreferrer">
                        {children}
                      </a>
                    ) : (
                      <span className="muted">{children}</span>
                    ),
                  img: ({ alt, ...props }) => <img {...props} alt={alt || ''} loading="lazy" />,
                }}
              >
                {post.markdown}
              </Markdown>
            </article>
          )}
        </>
      )}
    </main>
  );
}
