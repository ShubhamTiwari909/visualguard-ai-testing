import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkLinks } from './check-links.mjs';
import { remarkDocsLinks } from '../../apps/docs/src/lib/remark-docs-links.mjs';
import { root, matter } from './shared.mjs';
import { navigationErrors } from '../../apps/docs/src/data/navigation.mjs';

test('navigation rejects deleted guide destinations, duplicate entries and inaccessible new articles', () => {
  const groups = [{ label: 'Start', items: [{ slug: 'start' }, { items: [{ slug: 'missing' }, { slug: 'start' }] }] }];
  assert.deepEqual(navigationErrors(['start', 'new-guide'], groups), [
    'Missing navigation page: missing',
    'Duplicate navigation page: start',
    'Unlisted public page: new-guide',
  ]);
});

test('project-path output resolves encoded anchors and detects missing sections and escaped assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vg-docs-links-'));
  try {
    await mkdir(join(dir, 'guide'));
    await writeFile(join(dir, 'index.html'), '<a href="/manual/guide/#step%201">Guide</a><img src="/manual/icon.svg">');
    await writeFile(join(dir, 'guide/index.html'), '<h2 id="step 1">Step</h2><a href="../">Home</a>');
    await writeFile(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.deepEqual(await checkLinks(dir, { base: '/manual' }), { pages: 2, links: 3 });
    await writeFile(join(dir, 'guide/index.html'), '<h2 id="different">Changed</h2>');
    await assert.rejects(checkLinks(dir, { base: '/manual' }), /missing anchor/);
    await writeFile(join(dir, 'index.html'), '<img src="/icon.svg">');
    await assert.rejects(checkLinks(dir, { base: '/manual' }), /escapes configured base/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('article links retain external links and in-page anchors while honoring the deployment base', () => {
  const links = ['/start/quickstart/', '#capture', 'https://example.org/', '//cdn.example.org/image.png'];
  const tree = { children: links.map(url => ({ type: 'link', url })) };
  remarkDocsLinks({ base: '/manual/' })(tree);
  assert.deepEqual(tree.children.map(node => node.url), ['/manual/start/quickstart/', '#capture', 'https://example.org/', '//cdn.example.org/image.png']);
});

test('documentation publication requires a manual main-branch run and gives PR builds no deployment credentials', async () => {
  const yaml = async file => matter(`---\n${await readFile(join(root, '.github/workflows', file), 'utf8')}\n---\n`).data;
  const deploy = await yaml('docs-deploy.yml');
  assert.ok(deploy.on.workflow_dispatch);
  assert.equal(deploy.on.push, undefined);
  assert.equal(deploy.on.pull_request, undefined);
  assert.equal(deploy.jobs.build.if, "github.ref == 'refs/heads/main'");
  assert.equal(deploy.jobs.build.env.DOCS_PRODUCTION, 'true');
  assert.equal(deploy.jobs.deploy.permissions.pages, 'write');
  const check = await yaml('docs-check.yml');
  assert.equal(check.permissions.contents, 'read');
  assert.equal(check.permissions.pages, undefined);
  assert.equal(check.jobs.documentation.env.DOCS_PRODUCTION, undefined);
  assert.ok(check.jobs.documentation.steps.some(step => step.run === 'pnpm docs:check-links'));
});
