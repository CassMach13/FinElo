import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CODIGOS_PROIBIDOS,
  avaliarBaseline,
  reprovado,
} from './typeBaselinePolicy.mjs';

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

const veredito = avaliarBaseline(currentDiagnostics, expectedDiagnostics);
const { added, removed, forbidden } = veredito;

if (!reprovado(veredito)) {
  console.log(
    `Baseline TypeScript preservado: ${currentDiagnostics.length} diagnóstico(s) conhecido(s), nenhum novo.`
  );
  process.exit(0);
}

if (forbidden.length > 0) {
  console.error(
    `Diagnóstico de símbolo inexistente (${CODIGOS_PROIBIDOS.join(', ')}) — nunca aceito, nem registrado no baseline:`
  );
  for (const diagnostic of [...forbidden].sort()) {
    console.error(`! ${diagnostic}`);
  }
  console.error('');
  console.error(
    'Isto não é dívida de tipagem: o símbolo não existe, e a linha lança ReferenceError quando executada. Corrija o código — não registre no baseline.'
  );
}

if (added.length > 0 || removed.length > 0) {
  if (forbidden.length > 0) console.error('');
  console.error('O conjunto de diagnósticos TypeScript mudou.');
}

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
