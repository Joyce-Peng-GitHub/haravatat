import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { renderMarkdown } from '../server/markdown.js';
import { markdownPlugins, htmlPlugins } from '../web/src/markdown-config.js';

function publishAndRead(source: string) {
  const snapshot = renderMarkdown(
    [
      { path: 'main.md', content: Buffer.from(source) },
      { path: 'private.png', content: Buffer.from('not a referenced image') },
    ],
    'main.md',
    'post-id',
    new Map(),
  );
  return {
    ...snapshot,
    html: renderToStaticMarkup(
      createElement(Markdown, {
        remarkPlugins: markdownPlugins,
        rehypePlugins: htmlPlugins,
        skipHtml: true,
        children: snapshot.content.toString(),
      }),
    ),
  };
}

test('published Markdown renders every requested math delimiter without losing TeX', () => {
  const cases = [
    { source: String.raw`$\LaTeX$`, value: String.raw`\LaTeX`, display: false },
    { source: String.raw`\(a_1+\frac{1}{2}\)`, value: String.raw`a_1+\frac{1}{2}`, display: false },
    { source: String.raw`$$x^2$$`, value: 'x^2', display: true },
    { source: '$$\n\\sum_{i=1}^n i\n$$', value: String.raw`\sum_{i=1}^n i`, display: true },
    { source: String.raw`\[\int_0^1 x\,dx\]`, value: String.raw`\int_0^1 x\,dx`, display: true },
    { source: '```math\n\\sqrt{2}\n```', value: String.raw`\sqrt{2}`, display: true },
    { source: String.raw`> \[a_1+b_2\]`, value: 'a_1+b_2', display: true },
    {
      source: '> \\[\n> \\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n> \\]',
      value: String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,
      display: true,
    },
  ];
  for (const { source, value, display } of cases) {
    const { html } = publishAndRead(source);
    assert.match(html, /class="katex"/, source);
    assert.match(html, /<math[\s>]/, source);
    assert.equal(html.includes('class="katex-display"'), display, source);
    assert(!html.includes('katex-error'), source);
    assert(html.includes(value.replaceAll('&', '&amp;')), source);
  }
});

test('math is opaque to asset rewriting and code examples remain literal', () => {
  const { html, assets } = publishAndRead(
    [
      String.raw`$\text{![private](private.png)}$`,
      String.raw`\(\text{![private](private.png)}\)`,
      '`\\(x_1\\) ==literal== ~~literal~~`',
      '```text\n$\\LaTeX$ \\[x_1\\] ==literal==\n```',
      String.raw`\\(escaped\\) and \(unclosed`,
    ].join('\n\n'),
  );
  assert.equal(assets.length, 0);
  assert(!html.includes('<img'));
  assert.match(html, /<code>\\\(x_1\\\) ==literal== ~~literal~~<\/code>/);
  assert.match(html, /<code class="language-text">\$\\LaTeX\$ \\\[x_1\\\] ==literal==/);
  assert(html.includes('\\(escaped\\)'));
  assert(html.includes('(unclosed'));
});

test('GFM, nested highlights and all alert kinds survive the publication snapshot', () => {
  const source = [
    '~~旧内容~~ ==**重要内容**==',
    ...['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map(
      (kind) => `> [!${kind}]\n> 正文 $x^2$\n>\n> - 列表`,
    ),
    '> 普通引用',
    '> [!UNKNOWN]\n> 普通引用',
    '| A | B |\n| - | - |\n| 1 | 2 |',
    '- [x] 完成',
    '脚注[^1]\n\n[^1]: 注释内容',
  ].join('\n\n');
  const { html } = publishAndRead(source);
  assert.match(html, /<del>旧内容<\/del>/);
  assert.match(html, /<mark[^>]*><strong>重要内容<\/strong><\/mark>/);
  for (const kind of ['note', 'tip', 'important', 'warning', 'caution'])
    assert(html.includes(`markdown-alert-${kind}`));
  assert.equal((html.match(/<aside/g) || []).length, 5);
  assert.equal((html.match(/<blockquote/g) || []).length, 2);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /data-footnotes/);
});

test('untrusted HTML and math commands cannot inject markup or fetch external resources', () => {
  const { html } = publishAndRead(String.raw`<script>window.xss=1</script>

[unsafe](javascript:alert%281%29)

$\href{javascript:alert(1)}{unsafe}$

$\includegraphics{https://invalid.example/leak}$

$\htmlClass{injected}{text}$

$\notARealCommand{x}$

正文继续`);
  assert(!/<script|<img|href="javascript:|class="injected"/.test(html));
  assert(html.includes('正文继续'));
  assert(html.includes('notARealCommand'));
});
