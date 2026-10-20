import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const engineRequire = createRequire(join(root, 'packages/visualguard/package.json'));
const { createJiti } = engineRequire('jiti');
const jiti = createJiti(import.meta.url);
const { configSchema } = await jiti.import(join(root, 'packages/visualguard/src/config/schema.ts'));
const { z } = engineRequire('zod');
globalThis.__VISUALGUARD_VERSION__ = JSON.parse(await readFile(join(root, 'packages/visualguard/package.json'), 'utf8')).version;
const { createProgram } = await jiti.import(join(root, 'packages/visualguard/src/cli/program.ts'));
const check = process.argv.includes('--check');
const marker = '<!-- generated-reference -->';
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
async function update(file, body) {
  const path = join(root, 'apps/docs/src/content/docs', file);
  const prior = await readFile(path, 'utf8');
  const lead = prior.split(marker)[0];
  const next = lead + marker + '\n\n' + body.trim() + '\n';
  if (check && prior !== next) throw new Error(`Reference drift: run node scripts/docs/generate-reference.mjs (${file})`);
  if (!check) await writeFile(path, next);
}
const schema = z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' });
function type(field) {
  if (field.enum) return field.enum.map(x => JSON.stringify(x)).join(' / ');
  if ('const' in field) return JSON.stringify(field.const);
  if (field.anyOf) return field.anyOf.map(type).join(' or ');
  if (field.type === 'array') return `array of ${type(field.items ?? {})}`;
  return field.type ?? 'custom value';
}
function limits(field) {
  const result = [];
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) if (key in field) result.push(`${key}: ${JSON.stringify(field[key])}`);
  if (field.type === 'object' && field.additionalProperties && typeof field.additionalProperties === 'object') result.push(`named entries: ${type(field.additionalProperties)}`);
  if (field.required?.length) result.push(`required: ${field.required.join(', ')}`);
  return result.join('; ') || '—';
}
const rows = [];
function walk(field, path = '') {
  if (path) rows.push(`| \`${path}\` | ${cell(type(field))} | ${cell('default' in field ? '`' + JSON.stringify(field.default) + '`' : 'not set')} | ${cell(limits(field))} |`);
  for (const [key, value] of Object.entries(field.properties ?? {})) walk(value, path ? `${path}.${key}` : key);
  if (field.additionalProperties && typeof field.additionalProperties === 'object') walk(field.additionalProperties, `${path}.[name]`);
  if (field.items && typeof field.items === 'object' && field.items.properties) walk(field.items, `${path}[]`);
  for (const [index, branch] of (field.anyOf ?? []).entries()) if (branch.properties || branch.items?.properties) walk(branch, `${path} (variant ${index + 1})`);
}
walk(schema);
await update('reference/configuration.md', '## Field types, defaults and constraints\n\nGenerated from the current configuration input schema. `not set` means the field has no direct schema default; enclosing object defaults and runtime resolution still apply. Read the explanations below for functions, precedence and capture behavior.\n\n| Field | Type / choices | Direct default | Constraints |\n| --- | --- | --- | --- |\n' + rows.join('\n') + '\n\n## Runtime-only values\n\n`hooks.beforeNavigate` and `hooks.beforeCapture` are functions receiving the page, environment, route, URL and viewport. `reporters` contains objects with a name and `onEvent` and/or `onRunEnd`. These custom functions cannot be represented by JSON Schema; use executable JavaScript/TypeScript config, not JSON or a saved dashboard profile.\n\n`routes` must be nonempty/resolvable for actual capture, viewport names use letters/digits/hyphens, and at least one viewport is required. Runtime resolution validates the needed URLs for the selected mode. Explicit CLI overrides win over environment variables, then configuration, then defaults. `.env.local` overrides `.env`; existing process values win over both.\n\nSee [configuration](/guides/configuration/), [routing](/guides/routes/), [capture stability](/guides/stable-captures/), [AI policy](/guides/ai-policy-and-budgets/) and [repairs](/guides/fixes/) for behavioral explanations and complete examples.');
function describe(command, path, recursive = true) {
  const args = command.registeredArguments.map(arg => `${arg.required ? '<' : '['}${arg.name()}${arg.variadic ? '...' : ''}${arg.required ? '>' : ']'}`).join(' ');
  const body = [`## ${path}`, '', command.description(), '', '```sh', `${path}${args ? ' ' + args : ''} --help`, '```', ''];
  if (command.aliases().length) body.push(`Aliases: ${command.aliases().map(x => '`' + x + '`').join(', ')}.`, '');
  if (command.options.length) {
    body.push('| Option | Default | Meaning |', '| --- | --- | --- |');
    for (const option of command.options) body.push(`| \`${cell(option.flags)}\` | ${cell(option.defaultValue === undefined ? 'not set' : '`' + JSON.stringify(option.defaultValue) + '`')} | ${cell(option.description)}${option.argChoices ? ' Choices: ' + option.argChoices.join(', ') + '.' : ''} |`);
    body.push('');
  }
  if (recursive) for (const child of command.commands) body.push(describe(child, `${path} ${child.name()}`));
  return body.join('\n');
}
const program = createProgram();
await update('reference/cli/testing.md', describe(program, 'visualguard', false) + '\n' + program.commands.filter(c => c.name() !== 'dashboard').map(c => describe(c, `visualguard ${c.name()}`)).join('\n'));
await update('reference/cli/dashboard.md', describe(program.commands.find(c => c.name() === 'dashboard'), 'visualguard dashboard') + '\n\nDashboard startup options such as `--env-file` and `--data-dir` belong before the subcommand. Use `visualguard dashboard --env-file FILE publish ...`, not an application `.env.local` assumption. Source-only host recovery is documented separately and is not a package CLI endpoint.');
console.log(`Configuration and CLI references ${check ? 'match' : 'generated from'} the source contracts (${rows.length} configuration entries).`);
