/**
 * Script local de teste Belvo.
 * Nunca coloque credenciais neste arquivo.
 *
 * Uso:
 *   BELVO_SECRET_ID=... BELVO_SECRET_PASSWORD=... node test-belvo.js
 * ou defina as variáveis no .env.local (não versionado).
 */
const fetch = require('node-fetch');

async function test() {
  const secretId = process.env.BELVO_SECRET_ID;
  const secretPassword = process.env.BELVO_SECRET_PASSWORD;

  if (!secretId || !secretPassword) {
    console.error(
      'Defina BELVO_SECRET_ID e BELVO_SECRET_PASSWORD no ambiente antes de rodar este script.',
    );
    process.exit(1);
  }

  const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');

  const body = {
    id: secretId,
    password: secretPassword,
    scopes: 'read_institutions,write_links,read_accounts,read_transactions,read_owners',
  };

  const response = await fetch('https://sandbox.belvo.com/api/token/', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log('Status:', response.status);
  console.log('Response:', text);
}

test();
