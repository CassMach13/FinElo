# Evidências compactas — lote 3B

O [relatório](../ciclo-3-telas-financeiras.md#lote-3b--importação-completa) explica isolamento, escopo, matriz, limitações e a exceção de feedback autorizada. [summary.json](summary.json) consolida os resultados; os cinco manifestos resumidos de tela conservam hashes de fontes/resultados, totais e a referência verificável ao manifesto completo externo. O manifesto de impressão conserva os hashes de todas as páginas.

| Comparação selecionada | Escuro / antes | Claro / correção aprovada |
| --- | --- | --- |
| Mapeamento desktop, mesmos dados/rolamento | [Escuro](desktop-escuro-mapeamento.png) | [Claro](desktop-claro-mapeamento.png) |
| Revisão mobile, últimas colunas da tabela | [Escuro](mobile-escuro-revisao.png) | [Claro](mobile-claro-revisao.png) |
| Erro de arquivo antes oculto | [Baseline revisado](erro-escuro-antes.png) | [Feedback Escuro autorizado](erro-escuro-aprovado.png) |

Os PNGs correspondem, respectivamente, às entradas `files/desktop-{dark,light}-manual-previa-configurada.png`, `controls/mobile-{dark,light}-revisao-colunas-finais.png` e `files/desktop-{reviewed,dark}-arquivo-invalid-excel.png` do índice externo. A última comparação é uma diferença de conteúdo aprovada pelo usuário; não usa tolerância de rasterização.

O ZIP completo fica fora do Git, entregue localmente como `finelo-ciclo-3b-evidencias.zip`: 992 capturas de tela, 12 PDFs, renderizações, JSONs financeiros completos, logs e fontes. O [índice](index.json) lista tamanho e SHA-256 de cada arquivo; [summary.json](summary.json) informa hash e tamanho do ZIP. Reabrir o ZIP e conferir o índice valida os arquivos sem depender de miniaturas. Os bytes de fontes Windows são preservados no pacote; os selos financeiros dos testes normalizam LF. Runners de diagnóstico foram ampliados durante a consolidação, sem alteração posterior dos arquivos de produto capturados.

As quatro variantes usam os mesmos dados sintéticos e dimensões: main `6fa1188`, revisado `6f7a94b`, Escuro e Claro atuais. As cinco suítes comparam payloads, ledger e saldos. Não há sessão real, requisição externa ou inscrição de conta no piloto. A impressão conserva as limitações legadas documentadas; isto não declara certificação WCAG integral nem homologação de um provedor real.
