import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { errorMessage } from './api';
GlobalWorkerOptions.workerSrc = workerUrl;
interface PageView {
  page: PDFPageProxy;
  width: number;
  height: number;
}
export function PdfReader({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null),
    [pages, setPages] = useState<PageView[]>([]),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [width, setWidth] = useState(800),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(1, Math.floor(entries[0].contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setPages([]);
    setPdf(null);
    setError('');
    setLoading(true);
    const task = getDocument({
      url,
      cMapUrl: '/pdf-assets/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdf-assets/standard_fonts/',
      wasmUrl: '/pdf-assets/wasm/',
    });
    void (async () => {
      try {
        const document = await task.promise,
          result: PageView[] = [];
        for (let n = 1; n <= document.numPages; n++) {
          const page = await document.getPage(n),
            viewport = page.getViewport({ scale: 1 });
          if (cancelled) return;
          result.push({ page, width: viewport.width, height: viewport.height });
        }
        if (!cancelled) {
          setPdf(document);
          setPages(result);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);
  const goTo = async (destination: unknown) => {
    if (!pdf) return;
    try {
      const dest =
        typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
      if (!Array.isArray(dest)) return;
      const page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      container.current
        ?.querySelector(`[data-page-number="${page + 1}"]`)
        ?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      /* A malformed PDF destination must not interrupt reading. */
    }
  };
  return (
    <div className="pdf-reader" ref={container} aria-label="PDF 连续阅读">
      {loading && (
        <p className="empty" role="status">
          正在加载排版文章…
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          PDF 显示失败：{error} <a href={url}>下载 PDF</a>
        </div>
      )}
      {pages.map((view) => (
        <PdfPage key={view.page.pageNumber} view={view} width={width} goTo={goTo} />
      ))}
    </div>
  );
}
function PdfPage({
  view,
  width,
  goTo,
}: {
  view: PageView;
  width: number;
  goTo: (dest: unknown) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [links, setLinks] = useState<{ rect: number[]; url?: string; dest?: unknown }[]>([]),
    [error, setError] = useState('');
  const scale = width / view.width,
    height = (width * view.height) / view.width;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setVisible(entries[0].isIntersecting), {
      rootMargin: '1000px',
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current || !text.current) return;
    let cancelled = false;
    setError('');
    const element = canvas.current,
      textElement = text.current,
      viewport = view.page.getViewport({ scale });
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
    );
    element.width = Math.ceil(viewport.width * ratio);
    element.height = Math.ceil(viewport.height * ratio);
    textElement.replaceChildren();
    const render = view.page.render({
      canvas: element,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    let layer: TextLayer | undefined;
    void (async () => {
      try {
        await render.promise;
        if (cancelled) return;
        layer = new TextLayer({
          textContentSource: await view.page.getTextContent(),
          container: textElement,
          viewport,
        });
        if (cancelled) return;
        await layer.render();
        const annotations = await view.page.getAnnotations();
        if (!cancelled)
          setLinks(
            annotations
              .filter((a) => a.subtype === 'Link' && a.rect && (a.url || a.dest))
              .map((a) => ({
                rect: [
                  ...viewport.convertToViewportPoint(a.rect[0], a.rect[1]),
                  ...viewport.convertToViewportPoint(a.rect[2], a.rect[3]),
                ],
                url: a.url && /^https?:\/\//i.test(a.url) ? a.url : undefined,
                dest: a.dest,
              })),
          );
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      render.cancel();
      layer?.cancel();
      textElement.replaceChildren();
      element.width = 0;
      element.height = 0;
      setLinks([]);
    };
  }, [visible, scale, view.page]);
  return (
    <section
      className="pdf-page"
      ref={root}
      data-page-number={view.page.pageNumber}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--total-scale-factor': scale * view.page.userUnit,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as React.CSSProperties
      }
      aria-label={`第 ${view.page.pageNumber} 页`}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div className="textLayer" ref={text} />
      {error && (
        <p className="pdf-page-error" role="alert">
          此页显示失败：{error}
        </p>
      )}
      {links.map((link, i) => (
        <a
          key={i}
          className="pdf-link"
          href={link.url || '#'}
          aria-label={link.url || '跳转到文内链接'}
          rel="noopener noreferrer"
          onClick={(event) => {
            if (!link.url) {
              event.preventDefault();
              void goTo(link.dest);
            }
          }}
          style={{
            left: Math.min(link.rect[0], link.rect[2]),
            top: Math.min(link.rect[1], link.rect[3]),
            width: Math.abs(link.rect[2] - link.rect[0]),
            height: Math.abs(link.rect[3] - link.rect[1]),
          }}
        />
      ))}
    </section>
  );
}
