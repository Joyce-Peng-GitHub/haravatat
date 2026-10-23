import { test, expect } from '@playwright/test';
import { renderMarkdown } from '../../server/markdown.js';

test('footnote links return to each reference in the article', async ({ page }) => {
  const source = [
    '# 脚注跳转',
    '第一处引用[^note]',
    ...Array.from({ length: 35 }, (_, i) => `段落 ${i}：为跳转测试保留足够的正文高度。`),
    '第二处引用[^note]',
    ...Array.from({ length: 35 }, (_, i) => `后续段落 ${i}：继续正文。`),
    '[^note]: 脚注说明。',
  ].join('\n\n');
  const snapshot = renderMarkdown(
    [{ path: 'main.md', content: Buffer.from(source) }],
    'main.md',
    'navigation',
    new Map(),
  );
  await page.route('**/api/posts/navigation', (route) =>
    route.fulfill({
      json: {
        post: {
          id: 'navigation',
          title: '脚注跳转',
          format: 'markdown',
          markdown: snapshot.content.toString(),
          published_at: '2026-10-24T00:00:00Z',
          name: '作者',
          login: 'author',
          avatar_url: 'https://avatars.githubusercontent.com/u/101',
          source_name: 'notes',
        },
      },
    }),
  );
  await page.goto('/p/navigation');
  await expect(page.locator('.markdown-body [data-footnotes]')).toBeVisible();
  const references = page.locator('.markdown-body sup a');
  await expect(references).toHaveCount(2);
  const targets = await references.evaluateAll((links) =>
    links.map((link) => ({ id: link.id, href: link.getAttribute('href')! })),
  );
  expect(
    targets.every(({ id }) => id.length > 0),
    'footnote references need IDs for return links',
  ).toBe(true);
  for (let index = 0; index < 2; index++) {
    await references.nth(index).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(targets[index].href);
    const backlinks = page.locator('.markdown-body a[data-footnote-backref]');
    await expect(backlinks).toHaveCount(2);
    await backlinks.nth(index).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${targets[index].id}`);
    await expect
      .poll(() =>
        references.nth(index).evaluate((element) => {
          const { top, bottom } = element.getBoundingClientRect();
          return top >= -1 && bottom <= innerHeight;
        }),
      )
      .toBe(true);
  }
});
