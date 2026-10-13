import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import { posix } from 'node:path';
import type { SourceFile } from './files.js';
const mediaTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};
export interface Asset extends SourceFile {
  media_type: string;
}
export function renderMarkdown(
  files: SourceFile[],
  entry: string,
  postId: string,
  posts: Map<string, string>,
) {
  const content = files.find((f) => f.path === entry)!.content.toString('utf8');
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
  const tree = processor.parse(content),
    assets = new Map<string, Asset>();
  let title = posix.basename(entry).replace(/\.(md|markdown)$/i, '');
  let hasHeading = false;
  visit(tree, 'heading', (node) => {
    if (!hasHeading && node.depth === 1) {
      const parts: string[] = [];
      visit(node, 'text', (text) => {
        parts.push(text.value);
      });
      if (parts.length) {
        title = parts.join('');
        hasHeading = true;
      }
    }
  });
  visit(tree, (node) => {
    if (node.type !== 'image' && node.type !== 'link' && node.type !== 'definition') return;
    const url = node.url;
    if (!url || url.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//'))
      return;
    try {
      const resolved = new URL(url, `https://workspace.invalid/${entry}`);
      const path = decodeURIComponent(resolved.pathname.slice(1));
      if (posts.has(path)) {
        node.url = `/p/${posts.get(path)}${resolved.hash}`;
        return;
      }
      const file = files.find((f) => f.path === path);
      const type = mediaTypes[posix.extname(path).toLowerCase()];
      if (file && type) {
        assets.set(path, { ...file, media_type: type });
        node.url = `/api/posts/${postId}/assets/${encodeURIComponent(path)}`;
      } else {
        node.url = '';
      }
    } catch {
      node.url = '';
    }
  });
  return {
    content: Buffer.from(processor.stringify(tree)),
    title: title.slice(0, 200),
    assets: [...assets.values()],
  };
}
