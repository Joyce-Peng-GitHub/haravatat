import { test, expect } from '@playwright/test';
import { renderMarkdown } from '../../server/markdown.js';

for (const label of ['note', '中文注释']) {
  test(`footnote links return to each reference in the article (${label})`, async ({ page }) => {
    const source = [
      '# 脚注跳转',
      '第一处引用[^note]',
      ...Array.from({ length: 35 }, (_, i) => `段落 ${i}：为跳转测试保留足够的正文高度。`),
      '第二处引用[^note]',
      ...Array.from({ length: 35 }, (_, i) => `后续段落 ${i}：继续正文。`),
      '[^note]: 脚注说明。',
    ]
      .join('\n\n')
      .replaceAll('note', label);
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
}

test('TOC links scroll to unique headings and restore fragments after async loading', async ({
  page,
}) => {
  const longTitle = '长标题'.repeat(60);
  const source = [
    '# 目录导航',
    '[TOC]',
    '## 第一部分',
    ...Array.from({ length: 35 }, (_, i) => `段落 ${i}：正文中的内容。`),
    '#### 跳级子标题',
    ...Array.from({ length: 25 }, (_, i) => `中间段落 ${i}。`),
    '## 重复标题',
    ...Array.from({ length: 25 }, (_, i) => `后续段落 ${i}。`),
    '## 重复标题',
    `### ${longTitle}`,
    ...Array.from({ length: 25 }, (_, i) => `尾部段落 ${i}。`),
  ].join('\n\n');
  const snapshot = renderMarkdown(
    [{ path: 'main.md', content: Buffer.from(source) }],
    'main.md',
    'toc',
    new Map(),
  );
  let requests = 0;
  let delay = false;
  await page.route('**/api/posts/toc', async (route) => {
    requests++;
    if (delay) await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      json: {
        post: {
          id: 'toc',
          title: '目录导航',
          format: 'markdown',
          markdown: snapshot.content.toString(),
          published_at: '2026-10-24T00:00:00Z',
          name: '作者',
          login: 'author',
          avatar_url: 'https://avatars.githubusercontent.com/u/101',
          source_name: 'notes',
        },
      },
    });
  });
  await page.goto('/p/toc');
  const menu = page.getByRole('navigation', { name: '文章目录' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link')).toHaveCount(6);
  await expect(menu.locator('ol ol ol')).toHaveCount(2);
  const duplicates = menu.getByRole('link', { name: '重复标题', exact: true });
  const first = await duplicates.first().getAttribute('href');
  const second = await duplicates.last().getAttribute('href');
  expect(first).not.toBe(second);
  const target = page
    .locator('.markdown-body h2')
    .filter({ hasText: /^重复标题$/ })
    .last();
  const initialRequests = requests;
  await duplicates.last().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(second);
  const atTarget = () =>
    target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.top < 80;
    });
  await expect.poll(atTarget).toBe(true);
  expect(requests, 'fragment clicks should not fetch the article again').toBe(initialRequests);
  await menu.getByRole('link', { name: '第一部分', exact: true }).click();
  await page.goBack();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(second);
  await expect.poll(atTarget).toBe(true);
  // Keep the request unresolved until after the browser's initial fragment lookup.
  delay = true;
  await page.reload();
  await expect(target).toBeVisible();
  await expect.poll(atTarget).toBe(true);
  expect(requests).toBeGreaterThan(initialRequests);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/p/toc');
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const titleHeight = await menu
    .locator('.markdown-toc-title')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(titleHeight, 'menu title stays above its list without wrapping vertically').toBeLessThan(
    40,
  );
  await page.screenshot({ path: 'test-results/mobile-markdown-toc.png', fullPage: false });
  await menu.getByRole('link', { name: '跳级子标题', exact: true }).click();
  const subheading = page.locator('.markdown-body h4');
  await expect
    .poll(() =>
      subheading.evaluate((element) => {
        const { top } = element.getBoundingClientRect();
        return top >= 0 && top < 80;
      }),
    )
    .toBe(true);
  await page.goto('/p/toc#%invalid');
  await expect(menu).toBeVisible();
});
