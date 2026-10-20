import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

export const root = resolve(import.meta.dirname, '../..');
export const docsRoot = join(root, 'apps/docs');
export const contentRoot = join(docsRoot, 'src/content/docs');
const require = createRequire(join(docsRoot, 'package.json'));
export const matter = require('gray-matter');
export const parse = (await import(require.resolve('parse5'))).parse;
export async function files(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name), suffix) : !suffix || suffix.test(entry.name) ? [join(directory, entry.name)] : []))).flat();
}
export function headings(text) {
  let fence = false;
  const result = [];
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const match = line.match(/^#{1,6} (.+?)\s*$/);
      if (match) result.push(match[1]);
    }
  }
  return result;
}
export async function articles() {
  return await Promise.all((await files(contentRoot, /\.mdx?$/)).map(async path => ({ path, ...matter(await readFile(path, 'utf8')) })));
}
export function fail(errors) {
  if (errors.length) throw new Error(errors.map(x => `• ${x}`).join('\n'));
}
