import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const labels: Record<string, string> = {
  NOTE: '提示',
  TIP: '建议',
  IMPORTANT: '重要',
  WARNING: '警告',
  CAUTION: '注意',
};

export const remarkAlerts: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'blockquote', (node) => {
    const first = node.children[0];
    if (first?.type !== 'paragraph' || first.children[0]?.type !== 'text') return;
    const text = first.children[0];
    const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/.exec(text.value);
    if (!match) return;
    const kind = match[1];
    text.value = text.value.slice(match[0].length);
    if (!text.value) first.children.shift();
    if (!first.children.length) node.children.shift();
    node.data = {
      hName: 'aside',
      hProperties: { className: ['markdown-alert', `markdown-alert-${kind.toLowerCase()}`] },
    };
    node.children.unshift({
      type: 'paragraph',
      data: { hProperties: { className: ['markdown-alert-title'] } },
      children: [{ type: 'text', value: labels[kind] }],
    });
  });
};
