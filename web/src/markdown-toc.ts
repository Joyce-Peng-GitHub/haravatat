import type { Heading, Nodes, Paragraph, Root } from 'mdast';
import type { Element } from 'hast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

interface Entry {
  depth: number;
  title: string;
  id: string;
  children: Entry[];
}
function headingText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.type === 'break') return ' ';
  if (node.type === 'html' || node.type === 'footnoteReference') return '';
  if ('value' in node) return node.value;
  if ('children' in node) return node.children.map(headingText).join('');
  return '';
}
function tocList(entries: Entry[]): Element {
  return {
    type: 'element',
    tagName: 'ol',
    properties: {},
    children: entries.map((entry): Element => ({
      type: 'element',
      tagName: 'li',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: `#${encodeURIComponent(entry.id)}` },
          children: [{ type: 'text', value: entry.title }],
        },
        ...(entry.children.length ? [tocList(entry.children)] : []),
      ],
    })),
  };
}
const isMarker = (node: Root['children'][number]): node is Paragraph =>
  node.type === 'paragraph' &&
  node.children.length === 1 &&
  node.children[0].type === 'text' &&
  /^\[toc\]$/i.test(node.children[0].value.trim());

export const remarkToc: Plugin<[], Root> = () => (tree) => {
  const outline: Entry[] = [],
    stack: Entry[] = [];
  const used = new Set<string>();
  const add = (heading: Heading) => {
    const title = headingText(heading).trim() || '无标题';
    const slug =
      title
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const base = `heading-${slug}`;
    let id = base,
      suffix = 0;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    heading.data ||= {};
    heading.data.hProperties = { ...heading.data.hProperties, id };
    const entry: Entry = { depth: heading.depth, title, id, children: [] };
    while (stack.length && stack.at(-1)!.depth >= entry.depth) stack.pop();
    (stack.at(-1)?.children || outline).push(entry);
    stack.push(entry);
  };
  visit(tree, (node) => {
    // Footnote headings belong to the note, not to the article's outline.
    if (node.type === 'footnoteDefinition') return SKIP;
    if (node.type === 'heading') add(node);
  });
  tree.children = tree.children.flatMap<Root['children'][number]>((node) => {
    if (!isMarker(node)) return [node];
    if (!outline.length) return [];
    return [
      {
        type: 'paragraph',
        children: [],
        data: {
          hName: 'nav',
          hProperties: { className: ['markdown-toc'], ariaLabel: '文章目录' },
          hChildren: [
            {
              type: 'element',
              tagName: 'p',
              properties: { className: ['markdown-toc-title'] },
              children: [{ type: 'text', value: '目录' }],
            },
            tocList(outline),
          ],
        },
      },
    ];
  });
};
