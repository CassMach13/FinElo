# Laboratório isolado R2B

Não é importado pelo FinElo nem modifica seus arquivos de produto. O worker e a API fictícia só são servidos pelo `server.py` em loopback. Os exemplos de ID/centavos não são um contrato financeiro novo do produto.

Requisitos: Python 3.13, Chrome/Edge instalados, Playwright Python 1.64.1, pyee 13.0.1 e greenlet 3.3.2. Instale o driver em `node_modules/.finelo-cycle4d-r2b-tools/python` ou no ambiente Python usado para o laboratório. Não abra um perfil pessoal de navegador. O executor usa contextos descartáveis.

```powershell
python -m pip install --target node_modules/.finelo-cycle4d-r2b-tools/python playwright==1.64.1 pyee==13.0.1 greenlet==3.3.2
python scripts/diagnostics/pwa-r2b/validate.py --label reproducao-cooperativa
```

Para o legado, restaure os artefatos sintéticos imutáveis, sem sobrescrever diretórios existentes, usando o ZIP R1 aplicado indicado no relatório. Execute **depois** de encerrar os servidores cooperativos, pois ambos usam a porta neutra 5222:

```powershell
python scripts/diagnostics/pwa-r2-restore-r1.py CAMINHO_DO_ZIP_R1_APLICADO
python scripts/diagnostics/pwa-r2b/legacy.py
```

O legado termina com exit code 1 quando reproduz perdas residuais. Não acrescente `|| true` nem converta esses FAILs em PASS. A matriz cooperativa também sai com código 1 se algum cenário falhar. Cada `--label` novo congela as fontes; nunca reutilize um nome de snapshot.

`--only` permite reexecutar cenários específicos; `--channels msedge`/`chrome` seleciona o navegador. ACK 700 ms, RPC 1.800 ms e lease 8.000 ms são fixos. Os testes `script-suspended` e `owner-script-suspended-expiry` usam **emulação CDP**, não suspensão física. `lifecycle-event-contract` injeta um evento para validar seu contrato, sem alegar congelamento nativo. As tentativas de freeze nativo sem confirmação continuam no pacote.

O servidor usa 5221/5222; o legado usa o preview histórico 5210 e a página neutra 5222. Ambos fecham seus servidores/contextos no `finally`. Não execute este laboratório em interfaces de rede públicas nem contra um backend real.

O [relatório](../../../docs/temas/ciclo-4d-r2b-estrategia-migracao.md) apresenta as alternativas, matrizes, limites e os diffs de referência separados por camada. Não aplicar esses diffs como integração de produção. **NO-GO mantido.**
