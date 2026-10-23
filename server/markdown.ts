import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkBracketMath } from '../shared/markdown.js';
import remarkStringify from 'remark-stringify';
import { SKIP, visit } from 'unist-util-visit';
import type { Definition, FootnoteDefinition, Image, Link, Nodes } from 'mdast';
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
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkBracketMath)
    .use(remarkStringify);
  const tree = processor.runSync(processor.parse(content), content),
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
  // Match rendering semantics: the first definition wins, and unused
  // definitions/footnotes must not make private dependency bytes public.
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  visit(tree, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier.toUpperCase()))
      definitions.set(node.identifier.toUpperCase(), node);
    if (node.type === 'footnoteDefinition' && !footnotes.has(node.identifier.toUpperCase()))
      footnotes.set(node.identifier.toUpperCase(), node);
  });
  const resources = new Set<Image | Link | Definition>();
  const referencedNotes = new Set<string>();
  const collectResources = (root: Nodes) =>
    visit(root, (node) => {
      if (node.type === 'definition' || node.type === 'footnoteDefinition') return SKIP;
      if (node.type === 'image' || node.type === 'link') resources.add(node);
      if (node.type === 'imageReference' || node.type === 'linkReference') {
        const definition = definitions.get(node.identifier.toUpperCase());
        if (definition) resources.add(definition);
      }
      if (node.type === 'footnoteReference') referencedNotes.add(node.identifier.toUpperCase());
    });
  collectResources(tree);
  // Set iteration also visits notes discovered inside another referenced note.
  for (const identifier of referencedNotes)
    for (const child of footnotes.get(identifier)?.children || []) collectResources(child);
  for (const node of resources) {
    const url = node.url;
    if (!url || url.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//'))
      continue;
    try {
      const resolved = new URL(url, `https://workspace.invalid/${entry}`);
      const path = decodeURIComponent(resolved.pathname.slice(1));
      if (posts.has(path)) {
        node.url = `/p/${posts.get(path)}${resolved.hash}`;
        continue;
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
  }
  return {
    content: Buffer.from(processor.stringify(tree)),
    title: title.slice(0, 200),
    assets: [...assets.values()],
  };
}
