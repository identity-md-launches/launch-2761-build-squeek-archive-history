// The site has no build step: this copies src/ to dist/ unchanged and checks
// that every local asset index.html references exists, with a relative URL.
import { cpSync, existsSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href|content)="([^"#][^"]*\.(?:js|css|svg|png))"/g)].map((m) => m[1]);
const problems = [];
for (const ref of refs) {
  if (/^https?:/.test(ref)) continue;
  if (ref.startsWith('/')) problems.push(`absolute URL: ${ref}`);
  else if (!existsSync(join(dist, ref))) problems.push(`missing: ${ref}`);
}
// Module imports must be relative too.
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(dist).filter((f) => f.endsWith('.js'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/^import [^;]* from '([^']+)'/gm)) {
    if (!m[1].startsWith('./') && !m[1].startsWith('../')) problems.push(`${relative(dist, file)} imports ${m[1]}`);
    else if (!existsSync(join(dirname(file), m[1]))) problems.push(`${relative(dist, file)} imports missing ${m[1]}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const bytes = walk(dist).reduce((n, f) => n + statSync(f).size, 0);
console.log(`dist/ written: ${walk(dist).length} files, ${bytes} bytes, ${refs.length} asset references checked`);
