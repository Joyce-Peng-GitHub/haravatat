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

test('TOC markers survive publishing and produce unique, nested Unicode heading links', () => {
  const { html } = publishAndRead(
    [
      '# 文章',
      '[TOC]',
      '## 中文 **标题** 与 `code`',
      '#### 跳级 $x^2$',
      '## 中文 标题 与 code',
      '## 中文 标题 与 code-1',
      '## 中文 标题 与 code',
      '## !!!',
      '## ???',
      '## ![图示](https://example.com/image.png)',
      '[toc]',
      '正文[^note]',
      '[^note]: 脚注正文\n\n    ## 脚注标题',
    ].join('\n\n'),
  );
  const headings = [...html.matchAll(/<h[1-6] id="(heading-[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(headings, [
    'heading-文章',
    'heading-中文-标题-与-code',
    'heading-跳级-x2',
    'heading-中文-标题-与-code-1',
    'heading-中文-标题-与-code-1-1',
    'heading-中文-标题-与-code-2',
    'heading-section',
    'heading-section-1',
    'heading-图示',
  ]);
  assert.equal(new Set(headings).size, headings.length);
  const menus = [
    ...html.matchAll(/<nav class="markdown-toc" aria-label="文章目录">([\s\S]*?)<\/nav>/g),
  ];
  assert.equal(menus.length, 2);
  for (const menu of menus) {
    const targets = [...menu[1].matchAll(/href="#([^"]+)"/g)].map((match) =>
      decodeURIComponent(match[1]),
    );
    assert.deepEqual(targets, headings);
    assert(!menu[1].includes('脚注标题'));
    assert(!menu[1].includes('Footnotes'));
    assert(!/<img|<strong|<code|<span class="katex"/.test(menu[1]));
    assert.match(
      menu[1],
      /<ol><li><a[^>]*>文章<\/a><ol><li><a[^>]*>中文 标题 与 code<\/a><ol><li>/,
    );
  }
  assert.match(html, /data-footnotes/);
});

test('TOC expands only standalone top-level markers and titles have anchors without a TOC', () => {
  const { html } = publishAndRead(
    [
      '# Heading',
      '`[TOC]`',
      '```markdown\n[TOC]\n```',
      '> [TOC]',
      '普通句子中的 [TOC] 保持原样。',
      '[TOC] 不是独占标记',
      '- [TOC]',
    ].join('\n\n'),
  );
  assert(!html.includes('markdown-toc'));
  assert.match(html, /<h1 id="heading-heading">Heading<\/h1>/);
  assert.match(html, /<code>\[TOC\]<\/code>/);
  assert.match(html, /<blockquote>\n<p>\[TOC\]<\/p>/);
  assert(!publishAndRead('[TOC]').html.includes('markdown-toc'));
  // Text used in the menu stays escaped, not executable HTML.
  const untrusted = publishAndRead('[TOC]\n\n## `</a><script>alert(1)</script>`').html;
  assert(!untrusted.includes('<script>'));
  assert(untrusted.includes('&lt;script&gt;'));
});

test('only rendered references and reachable footnotes publish local image assets', () => {
  for (const source of [
    '# Public\n\nVisible text only.\n\n[unused]: private.png',
    '# Public\n\n[^unused]: ![private](private.png)',
    '# Public\n\n[visible][image]\n\n[image]: https://example.com/public.png\n\n[image]: private.png',
  ]) {
    const { assets } = publishAndRead(source);
    assert.equal(assets.length, 0, source);
  }
  for (const source of [
    '![image][used]\n\n[used]: private.png',
    '[used][]\n\n[used]: private.png',
    '[used]\n\n[used]: private.png',
    '正文[^note]\n\n[^note]: ![image][used]\n\n[used]: private.png',
    '正文[^first]\n\n[^first]: 另一条脚注[^second]\n\n[^second]: ![image](private.png)',
  ]) {
    const { assets, html } = publishAndRead(source);
    assert.equal(assets.length, 1, source);
    assert(html.includes('/api/posts/post-id/assets/private.png'), source);
  }
});
