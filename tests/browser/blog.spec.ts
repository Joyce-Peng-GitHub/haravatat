import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('folder uploads optionally ignore all hidden paths and finish with nested paths intact', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'haravatat-folder-'));
  const folder = join(directory, 'notes');
  await mkdir(join(folder, '.git', 'objects'), { recursive: true });
  await mkdir(join(folder, '课程', '.cache'), { recursive: true });
  await writeFile(join(folder, '课程', '.cache', 'data'), 'hidden nested file');
  await writeFile(join(folder, '.env'), 'EXAMPLE=true');
  await mkdir(join(folder, '课程'), { recursive: true });
  await writeFile(join(folder, '.git', 'config'), 'private repository metadata');
  await writeFile(join(folder, '.git', 'objects', 'pack'), Buffer.alloc(4 * 1024 * 1024));
  await writeFile(join(folder, '课程', '文章.md'), '# Folder upload');
  await writeFile(join(folder, 'image.bin'), Buffer.alloc(2 * 1024 * 1024, 0xa5));
  try {
    await page.route(/\/auth\/github$/, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const state = new URL(response.headers().location).searchParams.get('state');
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          location: `${new URL(route.request().url()).origin}/auth/github/callback?code=test&state=${state}`,
        },
      });
    });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: '通过 GitHub 登录' }).click();
    await page.getByRole('button', { name: '新建来源' }).click();
    await page.getByLabel('来源名称').fill('文件夹回归测试');
    await page.getByRole('button', { name: '创建来源' }).click();
    await expect(page.getByRole('heading', { name: '文件夹回归测试' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '忽略隐藏文件和文件夹' })).toBeChecked();
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await expect(page.getByText(/文件已上传。勾选入口后发布，线上文章才会更新。/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/已跳过 4 个隐藏文件/)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '发布 notes/课程/文章.md' })).toBeVisible();
    const workspace = await page.evaluate(async () => {
      const id = new URL(location.href).searchParams.get('source');
      return (await fetch(`/api/sources/${id}`)).json();
    });
    expect(workspace.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'notes/image.bin',
      'notes/课程/文章.md',
    ]);
    let requests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/upload')) requests++;
    });
    await page.getByLabel('上传目标目录').fill('../invalid');
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await expect(page.getByRole('alert')).toContainText('文件路径无效');
    expect(requests).toBe(0);
    await page.getByLabel('上传目标目录').clear();
    await page.route('**/api/sources/*/upload', (route) => route.abort('connectionreset'));
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await expect(page.getByRole('alert')).toContainText('上传连接中断');
    await page.unroute('**/api/sources/*/upload');
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await expect(page.getByText(/文件已上传。勾选入口后发布，线上文章才会更新。/)).toBeVisible();
    await page.getByRole('checkbox', { name: '忽略隐藏文件和文件夹' }).uncheck();
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await expect(page.getByText(/文件已上传。勾选入口后发布，线上文章才会更新。/)).toBeVisible();
    const complete = await page.evaluate(async () => {
      const id = new URL(location.href).searchParams.get('source');
      return (await fetch(`/api/sources/${id}`)).json();
    });
    expect(complete.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'notes/.env',
      'notes/.git/config',
      'notes/.git/objects/pack',
      'notes/image.bin',
      'notes/课程/.cache/data',
      'notes/课程/文章.md',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public Markdown and multi-page PDF reading work on desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '最新文章' })).toBeVisible();
  await expect(page.getByRole('link', { name: '文字、公式与慢思考' })).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
  await page.getByRole('link', { name: '文字、公式与慢思考' }).click();
  await expect(page.locator('.markdown-body table')).toBeVisible();
  await expect(page.locator('.markdown-body pre')).toContainText('console.log');
  await page.getByRole('link', { name: '返回文章' }).click();
  await page.getByRole('link', { name: '关于知识的边界' }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.pdf-page').first().locator('.textLayer')).toContainText('Knowledge');
  const geometry = await page.locator('.pdf-page').evaluateAll((elements) =>
    elements.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, width: r.width };
    }),
  );
  expect(Math.abs(geometry[1].top - geometry[0].bottom)).toBeLessThan(1);
  expect(await page.locator('iframe,[role=toolbar]').count()).toBe(0);
  await page.screenshot({ path: 'test-results/pdf-reader.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.pdf-page').first().locator('.textLayer')).toContainText('Knowledge');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/mobile-pdf.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('OAuth login, folder upload, editing, selection, publishing and HTTPS Git sync with pinned commits', async ({
  page,
}) => {
  await page.route(/\/auth\/github$/, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const state = new URL(response.headers().location).searchParams.get('state');
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        location: `${new URL(route.request().url()).origin}/auth/github/callback?code=test&state=${state}`,
      },
    });
  });
  await page.goto('/dashboard');
  await page.getByRole('link', { name: '通过 GitHub 登录' }).click();
  await expect(page.getByRole('heading', { name: /我的工作台/ })).toBeVisible();
  await page.getByRole('button', { name: '新建来源' }).click();
  await page.getByLabel('来源名称').fill('浏览器测试笔记');
  await page.getByRole('button', { name: '创建来源' }).click();
  await expect(page.getByRole('heading', { name: '浏览器测试笔记' })).toBeVisible();
  await page.getByLabel('上传目标目录').fill('notes');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([
      {
        name: 'article.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          [
            '# 浏览器发布\n\n**你好，世界**\n<script>window.xss=1</script>',
            String.raw`$\LaTeX$ 与 \(a_1+\frac{1}{2}\)`,
            '$$\n\\sum_{i=1}^n i\n$$',
            String.raw`\[\int_0^1 x\,dx\]`,
            '```math\n\\sqrt{2}\n```',
            '$$x^2$$',
            '~~已删除~~ ==**高亮文字**==',
            '> [!WARNING]\n> 请注意正文中的公式 $x_1$。',
            '> [!NOTE]\n> 这是一条提示。',
            '> [!TIP]\n> 这是一条建议。',
            '> [!IMPORTANT]\n> 这是一条重要说明。',
            '> [!CAUTION]\n> 这是一条注意事项。',
            '`$literal$ \\(literal\\) ==literal==`',
            '```text\n$literal$ \\[literal\\] ==literal==\n```',
            String.raw`\[\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{\text{long equation}}\]`,
          ].join('\n\n'),
        ),
      },
      {
        name: 'dependency.typ',
        mimeType: 'text/plain',
        buffer: Buffer.from('= Private dependency'),
      },
    ]);
  await expect(page.getByRole('checkbox', { name: '发布 notes/article.md' })).toBeVisible();
  await page.getByRole('button', { name: '目录 notes', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '发布 notes/article.md' })).toBeHidden();
  await page.getByLabel('筛选文件').fill('article.md');
  await expect(page.getByRole('checkbox', { name: '发布 notes/article.md' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '发布 notes/dependency.typ' })).toBeHidden();
  await page.getByLabel('筛选文件').clear();
  await page.getByRole('button', { name: '展开全部', exact: true }).click();
  await page.getByRole('checkbox', { name: '发布 notes/article.md' }).check();
  await page.getByLabel('notes/article.md 的文章标题').fill('浏览器发布');
  await page.getByRole('button', { name: '发布所选文章' }).click();
  await expect(page.getByText('发布成功，文章已出现在首页。')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('link', { name: '阅读', exact: true }).click();
  await expect(page.locator('.markdown-body strong').first()).toHaveText('你好，世界');
  await expect(page.locator('.markdown-body mark strong')).toHaveText('高亮文字');
  await expect(page.locator('.markdown-body del')).toHaveText('已删除');
  await expect(page.locator('.markdown-body .katex')).toHaveCount(8);
  await expect(page.locator('.markdown-body .katex-display')).toHaveCount(5);
  await expect(page.locator('.markdown-body .katex-error')).toHaveCount(0);
  await expect(page.locator('.markdown-alert')).toHaveCount(5);
  await expect(page.locator('.markdown-alert-warning')).toContainText('警告');
  await expect(page.locator('.markdown-body pre code')).toContainText('$literal$');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true);
  await page.screenshot({ path: 'test-results/markdown-extensions.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile-markdown-extensions.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  expect(await page.evaluate(() => 'xss' in window)).toBe(false);
  await page.getByRole('link', { name: '我的工作台' }).click();
  await page.getByRole('button', { name: /浏览器测试笔记/ }).click();
  const row = page.locator('.file-row[data-path="notes/article.md"]');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文件内容').fill('# Updated draft\n\n草稿更新后需要重新发布。');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存，发布后线上版本才会更新。')).toBeVisible();
  await page.getByRole('checkbox', { name: '发布 notes/dependency.typ' }).check();
  await page.getByLabel('notes/dependency.typ 的文章标题').fill('浏览器 Typst');
  await page.getByRole('button', { name: '发布所选文章' }).click();
  await expect(page.getByText('发布成功，文章已出现在首页。')).toBeVisible();
  await page
    .locator('.file-row')
    .filter({ has: page.locator('[title="notes/dependency.typ"]') })
    .getByRole('link', { name: '阅读', exact: true })
    .click();
  await expect(page.locator('.pdf-page .textLayer')).toContainText('Private dependency');
  await page.getByRole('link', { name: '我的工作台' }).click();
  await page.getByRole('button', { name: '新建来源' }).click();
  await page.getByRole('button', { name: 'Git 仓库', exact: true }).click();
  await page.getByLabel('来源名称').fill('GitLab 来源测试');
  await page.getByLabel('仓库地址').fill('https://gitlab.com/writer/group/notes.git');
  await page.getByLabel('分支名').fill('feature/blog');
  await page.getByLabel('Commit SHA（可选）', { exact: true }).fill('a'.repeat(40));
  await page.getByRole('button', { name: '创建来源' }).click();
  await expect(page.getByLabel('同步 Commit SHA')).toHaveValue('a'.repeat(40));
  await page.getByLabel('私有仓库访问 token').fill('private.token+/=');
  await page.getByLabel('仓库用户名', { exact: true }).fill('oauth2');
  await page.getByRole('button', { name: '保存凭据', exact: true }).click();
  await expect(page.getByText('服务器已保存加密凭据', { exact: true })).toBeVisible();
  await expect(page.getByLabel('私有仓库访问 token')).toHaveValue('');
  await page.getByRole('button', { name: '同步仓库' }).click();
  await expect(page.getByText('remote.md', { exact: true })).toBeVisible();
  await expect(page.getByLabel('私有仓库访问 token')).toHaveValue('');
  await expect(page.getByLabel('仓库用户名', { exact: true })).toHaveValue('');
  await page.route('**/api/sources/*/settings', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '测试设置保存失败' }),
    }),
  );
  await page.getByRole('checkbox', { name: '打开此工作台时自动同步' }).click();
  await expect(page.getByRole('alert')).toContainText('测试设置保存失败');
  await expect(page.getByRole('checkbox', { name: '打开此工作台时自动同步' })).not.toBeChecked();
  await page.unroute('**/api/sources/*/settings');
  await page.getByRole('checkbox', { name: '打开此工作台时自动同步' }).check();
  await expect(
    page.getByText('已开启：下次打开此工作台时自动同步。', { exact: true }),
  ).toBeVisible();
  const automaticRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/sync') && request.postDataJSON()?.automatic)
      automaticRequests.push(request.url());
  });
  await page.reload();
  await expect(page.getByText('自动同步完成，仓库没有新提交。', { exact: true })).toBeVisible();
  expect(automaticRequests).toHaveLength(1);
  await expect(page.getByText('服务器已保存加密凭据', { exact: true })).toBeVisible();
  await expect(page.getByLabel('私有仓库访问 token')).toHaveValue('');
  await page.route('**/api/sources/*/sync', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: '测试网络错误' }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('自动同步未完成');
  await expect(page.getByText('remote.md', { exact: true })).toBeVisible();
  expect(automaticRequests).toHaveLength(2);
  await page.unroute('**/api/sources/*/sync');
  await page.getByLabel('同步 Commit SHA').fill('c'.repeat(40));
  await page.getByRole('button', { name: '同步仓库' }).click();
  await expect(page.locator('.workspace-top code')).toContainText('ccccccc');
  await page.getByLabel('同步 Commit SHA').fill('');
  await page.getByRole('button', { name: '同步仓库' }).click();
  await expect(page.locator('.workspace-top code')).toContainText('bbbbbbb');
  await expect(page.getByLabel('同步 Commit SHA')).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '删除保存的凭据', exact: true }).click();
  await expect(page.getByText('未保存仓库凭据', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '打开此工作台时自动同步' })).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'GitLab 来源测试' })).toBeVisible();
  expect(automaticRequests).toHaveLength(2);
});
