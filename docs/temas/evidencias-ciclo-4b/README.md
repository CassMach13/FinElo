# Evidências compactas — Ciclo 4B

A matriz completa está em [ciclo-4b-investimentos.md](../ciclo-4b-investimentos.md). Dados exclusivamente sintéticos, quatro referências, desktop 1440×1000 e mobile 390×844.

| Referência | Desktop | Mobile |
| --- | --- | --- |
| Main / Escuro | [Main](v2-1440-ready-main.png) | No pacote completo |
| Escuro atual | [Desktop](v2-1440-ready-dark.png) | [Mobile](v2-390-ready-dark.png) |
| Claro atual | [Desktop](v2-1440-ready-light.png) | [Mobile](v2-390-ready-light.png) |

[Financiamento Claro mobile](assets-390-financing-light.png). [Métricas](metricas.json), [hashes dos seis PNGs](indice-imagens.json), [metadados do pacote](pacote.json).

904 capturas UI; 656 comparações financeiras; 424 paridades Escuras (422 exatas e duas com 10/20 pixels de ruído, delta 1, sem mudança de conteúdo/geometria/cores). 37.148 amostras AA, mínimos 4,936:1 texto e 3,567:1 essenciais. 16 PDFs/68 páginas idênticos. Cada render das corridas de conta consta no pacote.

Pacote externo local: **finelo-ciclo-4b-evidencias.zip**, 130453436 bytes. SHA-256:

```text
0275285f00cfbb1d41c8377581a0245ac8cfa62dd7da0e9f7632ba22f0d55fd1
```

Índice SHA-256: `2e279e47d679ff204d4441baad131b4d0a909b051022d0c9128b61385c551e35`. 2409 arquivos indexados, 985 referências de imagem e 443 PNGs únicos. CRC e todos os SHA verificados. As capturas iniciais e falhas de roteiros corrigidas ficam identificadas nos logs; as métricas descrevem a matriz final. Nenhum extrato privado foi publicado.

```powershell
Get-FileHash -LiteralPath .\finelo-ciclo-4b-evidencias.zip -Algorithm SHA256
```

O arquivo é entregue fora do Git; o hash acima deve coincidir antes de descompactá-lo. O relatório registra os limites legados (overflow mobile de 18 px, feedback de primeira carga, dados sintéticos de amortização), a exceção de sessão autorizada e o plano 4C. Não houve publicação geral do Claro.
