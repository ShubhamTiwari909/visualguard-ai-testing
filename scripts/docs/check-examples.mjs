import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { root, contentRoot } from './shared.mjs';

const require = createRequire(join(root, 'packages/visualguard/package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const { configSchema } = await jiti.import(join(root, 'packages/visualguard/src/config/schema.ts'));
const article = await readFile(join(contentRoot, 'start/quickstart.md'), 'utf8');
const config = article.match(/```ts\n([\s\S]*?)\n```/)[1].replace(/import[^\n]+\n/, '').replace('export default defineConfig(', '(').replace(/\);\s*$/, ')');
// This is a repository-owned, bounded literal fixture. No user or external input is evaluated.
const parsed = Function(`return (${config})`)();
assert.equal(configSchema.safeParse(parsed).success, true);
assert.equal(configSchema.safeParse({ ...parsed, viewports: { desktop: { width: 0, height: 800 } } }).success, false);
assert.equal(parsed.ai.provider, 'none');
assert.deepEqual(parsed.routes, ['/']);
const releases = JSON.parse(await readFile(join(root, 'apps/docs/src/data/releases.json')));
assert.match(article, new RegExp(`visualguard@${releases.publishedVersion.replaceAll('.', '\\.')}`));
const action = await readFile(join(root, 'action/action.yml'), 'utf8');
const actionDoc = await readFile(join(contentRoot, 'ci/github-actions.md'), 'utf8');
for (const input of [...action.split('outputs:')[0].matchAll(/^ {2}([a-z-]+):$/gm)].map(x => x[1])) assert.ok(actionDoc.includes('`' + input + '`'), `Undocumented Action input ${input}`);
console.log('Examples passed: quickstart config/constraints, release pin and every Action input.');
