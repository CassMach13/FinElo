# Evidências compactas — Ciclo 4C

[Relatório, matrizes e plano 4D](../ciclo-4c-cobertura-final.md). Dados exclusivamente sintéticos; desktop 1440×1000 e mobile 390×844. Os seis PNGs abaixo representam a árvore final do produto `ab91f69d3c1da868cf3ac5b815d5630e4b63f361`, após o fechamento do shell no 4C3.

| Superfície | Escuro | Claro |
| --- | --- | --- |
| Shell / Objetivos desktop | [Escuro](global-shell-1440-dark.png) | [Claro](global-shell-1440-light.png) |
| Ajuda / consentimento de anexo desktop | [Escuro](residual-file-consent-checked-1440-dark.png) | [Claro](residual-file-consent-checked-1440-light.png) |
| PIN mobile | [Escuro](global-pin-locked-390-dark.png) | [Claro](global-pin-locked-390-light.png) |

[Métricas](metricas.json), [hashes dos seis PNGs](indice-imagens.json), [metadados verificáveis do pacote](pacote.json). Imagens no Git: **511.826 bytes**, sem duplicar as matrizes completas ou evidências anteriores.

Matrizes principais: **840 capturas, 630 equivalências funcionais/financeiras e 420 paridades Escuras**, 403 exatas e 17 ruídos dentro do limite de 3A, com conteúdo, geometria e cores iguais. Mais 48 frames independentes de controles nativos, 16 de interação, quatro de foco/hover do aviso de assinatura e oito de fronteira pública estão no pacote. Frames auxiliares podem ser referências já usadas pela matriz canônica; não somar como novos cenários financeiros. **56 PDFs / 228 páginas PASS**. A matriz de acessibilidade distingue os quatro apontamentos antigos da estrela no checkpoint 4C1, encerrados pelo 4C3, de falhas atuais (zero no Claro).

Pacote externo local: **finelo-ciclo-4c-evidencias.zip**, **56.975.460 bytes**, 3.109 arquivos lógicos / 2.037 objetos únicos. CRC e todos os SHA verificados **duas vezes**.

SHA-256 do ZIP:

```text
380903f2ee675ce33f625bd213b2ff3e988eab0b11865f1424b8c1e69b20513a
```

SHA-256 de `index.json`:

```text
98645f93895ab2e894bd77bb3882885fdc489915a67858936f1b212f8ef82dcd
```

O ZIP usa objetos deduplicados por SHA. `index.json` associa cada caminho lógico a `objects/<sha256>` e informa tamanho/hash. Para reconstruir um arquivo, copiar os bytes do objeto para o caminho lógico; não interpretar o objeto como texto. O pacote inclui fontes dos dois baselines, fontes atuais, roteiros, payloads/resultados sintéticos, relatórios e PDFs. Resultados preliminares e rasters rejeitados são histórico diagnóstico, sem contar como PASS. Capturas C1/C2 preservam seu shell daquele checkpoint; o shell final está nas capturas C3. Extratos privados, credenciais e logs brutos de testes não foram exportados.

```powershell
Get-FileHash -LiteralPath .\finelo-ciclo-4c-evidencias.zip -Algorithm SHA256
python scripts/diagnostics/verify-theme-evidence.py .\finelo-ciclo-4c-evidencias.zip
```

A entrega é para revisão do 4C. Claro global continua bloqueado; Safari, aparelhos físicos, leitor de tela e PWA instalado pertencem ao 4D. Nenhum arquivo de evidências dos ciclos anteriores foi removido.
