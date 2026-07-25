import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const baselinePath = path.join(projectRoot, 'tests', 'baselines', 'typescript-errors.txt');
const tscEntryPoint = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

const result = spawnSync(process.execPath, [tscEntryPoint, '--noEmit', '--pretty', 'false'], {
  cwd: projectRoot,
  encoding: 'utf8',
  shell: false,
});

if (result.error) {
  console.error('Não foi possível executar o TypeScript:', result.error.message);
  process.exit(2);
}

const diagnosticPattern = /^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$/;
const normalizeDiagnostics = (rawOutput) =>
  rawOutput
    .split(/\r?\n/)
    .map((line) => line.match(diagnosticPattern))
    .filter(Boolean)
    .map((match) => `${match[1].replaceAll('\\', '/')} ${match[2]}: ${match[3]}`)
    .sort();

const currentDiagnostics = normalizeDiagnostics(`${result.stdout || ''}\n${result.stderr || ''}`);
const expectedDiagnostics = readFileSync(baselinePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .sort();

const currentSet = new Map();
const expectedSet = new Map();

for (const diagnostic of currentDiagnostics) {
  currentSet.set(diagnostic, (currentSet.get(diagnostic) || 0) + 1);
}
for (const diagnostic of expectedDiagnostics) {
  expectedSet.set(diagnostic, (expectedSet.get(diagnostic) || 0) + 1);
}

const added = [];
const removed = [];
const allDiagnostics = new Set([...currentSet.keys(), ...expectedSet.keys()]);

for (const diagnostic of allDiagnostics) {
  const currentCount = currentSet.get(diagnostic) || 0;
  const expectedCount = expectedSet.get(diagnostic) || 0;

  for (let index = expectedCount; index < currentCount; index += 1) {
    added.push(diagnostic);
  }
  for (let index = currentCount; index < expectedCount; index += 1) {
    removed.push(diagnostic);
  }
}

if (added.length === 0 && removed.length === 0) {
  console.log(
    `Baseline TypeScript preservado: ${currentDiagnostics.length} diagnóstico(s) conhecido(s), nenhum novo.`
  );
  process.exit(0);
}

console.error('O conjunto de diagnósticos TypeScript mudou.');

if (added.length > 0) {
  console.error('\nNovos diagnósticos:');
  for (const diagnostic of added.sort()) {
    console.error(`+ ${diagnostic}`);
  }
}

if (removed.length > 0) {
  console.error('\nDiagnósticos removidos (atualize o baseline conscientemente):');
  for (const diagnostic of removed.sort()) {
    console.error(`- ${diagnostic}`);
  }
}

console.error(
  '\nO baseline nunca deve ser atualizado para aceitar um erro novo sem revisão explícita.'
);
process.exit(1);
