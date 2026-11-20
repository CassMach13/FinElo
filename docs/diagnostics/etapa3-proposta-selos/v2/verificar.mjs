import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { build } from 'vite';
import { reverseSessionPatch } from '../../../../tests/appearance/reverseSessionPatch.ts';

const read = file => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const here = name => new URL(name, import.meta.url);
const manifest = JSON.parse(read(here('sha256-lf.json')));
const patch = read(here('etapa3-integracao-selada.patch'));
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(patch) !== manifest.patchSha256) throw Error('Hash do patch divergente.');
const inverse = patch.replace(/^@@ -([\d,]+) \+([\d,]+) @@/gm, '@@ -$2 +$1 @@')
  .replace(/^([-+])(?!\1\1 [ab]\/)/gm, sign => sign === '+' ? '-' : '+');
const candidates = new Map();
const canonical = file => path.resolve(file).replaceAll('\\', '/').toLowerCase();
for (const [file, digest] of Object.entries(manifest.files)) {
  const original = read(file);
  const proposed = reverseSessionPatch(original, inverse, file);
  if (sha(original) !== digest.before || sha(proposed) !== digest.proposed ||
      reverseSessionPatch(proposed, patch, file) !== original) throw Error('Reversão divergente ' + file);
  candidates.set(canonical(file), proposed);
}
const config = ts.getParsedCommandLineOfConfigFile('tsconfig.json', {}, {
  ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw Error(String(d.messageText)); },
});
const host = ts.createCompilerHost(config.options);
const readOriginal = host.readFile.bind(host);
host.readFile = file => candidates.get(canonical(file)) ?? readOriginal(file);
const program = ts.createProgram(config.fileNames, config.options, host);
const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
  const file = d.file ? path.relative('.', d.file.fileName).replaceAll('\\', '/') : '<global>';
  return file + ' TS' + d.code + ': ' + ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0];
}).sort();
const baseline = read('tests/baselines/typescript-errors.txt').trimEnd().split('\n').sort();
if (JSON.stringify(diagnostics) !== JSON.stringify(baseline)) {
  throw Error('Diferenças no baseline: ' + JSON.stringify(diagnostics.filter(d => !baseline.includes(d))));
}
console.log('Três hashes e reversões conferidos. TypeScript resolveu a proposta com ' + diagnostics.length + ' diagnósticos conhecidos.');
if (process.argv[2]) {
  const outDir = path.resolve(process.argv[2]);
  if (!path.relative(process.cwd(), outDir).startsWith('..')) throw Error('Use um diretório de QA fora do checkout.');
  const loaded = new Set();
  await build({ plugins: [{ name: 'fontes-candidatas', enforce: 'pre', load(id) {
    const key = canonical(id);
    if (candidates.has(key)) { loaded.add(key); return candidates.get(key); }
  } }], build: { outDir, emptyOutDir: false } });
  if (loaded.size !== candidates.size) throw Error('Build não consumiu todas as fontes candidatas.');
}
