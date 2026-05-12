const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'modelos de fatura', 'Cartao XP');

function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseMoney(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^\d,.-]/g, '');
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function collectCsvFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCsvFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
      files.push(fullPath);
    }
  }

  return files;
}

function analyzeCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);

  let expenses = 0;
  let payments = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let rowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const cols = row.split(';');
    if (cols.length < 5) continue;

    rowCount += 1;
    const estabelecimento = removeAccents((cols[1] || '').toLowerCase());
    const valorRaw = parseMoney(cols[3]);

    const isPayment =
      (estabelecimento.includes('pagamento') && estabelecimento.includes('valido')) ||
      estabelecimento.includes('pagamento de fatura');

    if (isPayment) {
      paymentCount += 1;
      payments += Math.abs(valorRaw);
      continue;
    }

    expenses += valorRaw;
    if (valorRaw < 0) refundCount += 1;
  }

  const balance = Math.max(expenses - payments, 0);
  return {
    file: path.relative(ROOT, filePath),
    rowCount,
    expenses,
    payments,
    balance,
    paymentCount,
    refundCount,
  };
}

function formatBrl(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function main() {
  if (!fs.existsSync(TARGET_DIR)) {
    console.error(`Pasta não encontrada: ${TARGET_DIR}`);
    process.exit(1);
  }

  const files = collectCsvFiles(TARGET_DIR).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const results = files.map(analyzeCsv);

  let totalExpenses = 0;
  let totalPayments = 0;
  let totalBalance = 0;

  console.log('=== Verificação Guiada - Cartão XP ===');
  console.log('Arquivo | Linhas | Compras líquidas | Pagamentos | Saldo aberto | Alertas');
  console.log('------- | ------ | ---------------- | ---------- | ------------ | -------');

  for (const r of results) {
    totalExpenses += r.expenses;
    totalPayments += r.payments;
    totalBalance += r.balance;

    const alerts = [];
    if (r.paymentCount === 0) alerts.push('sem-pagamento');
    if (r.paymentCount > 1) alerts.push(`pagamentos=${r.paymentCount}`);
    if (r.refundCount > 0) alerts.push(`estornos=${r.refundCount}`);

    console.log(
      `${path.basename(r.file)} | ${r.rowCount} | ${formatBrl(r.expenses)} | ${formatBrl(r.payments)} | ${formatBrl(r.balance)} | ${alerts.join(',') || 'ok'}`
    );
  }

  console.log('\n=== Totais ===');
  console.log(`Arquivos: ${results.length}`);
  console.log(`Compras líquidas: ${formatBrl(totalExpenses)}`);
  console.log(`Pagamentos: ${formatBrl(totalPayments)}`);
  console.log(`Saldo aberto agregado: ${formatBrl(totalBalance)}`);
}

main();
