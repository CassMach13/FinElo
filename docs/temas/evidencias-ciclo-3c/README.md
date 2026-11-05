# Evidências compactas — lote 3C

Os seis PNGs são pares Escuro/Claro do mesmo estado, dados e dimensões:

- Histórico desktop: `desktop-new-{dark,light}-historico-closed.png`.
- Pagamento mobile: `mobile-v2-{dark,light}-pagamento-second-payment.png`.
- Diagnóstico com avisos desktop: `desktop-legacy-{dark,light}-diagnostico-atencao.png`.

`summary.json` informa resultados, mínimos de contraste e SHA-256/tamanho do pacote externo `finelo-ciclo-3c-evidencias.zip`. Os manifestos compactos conservam bases, selos das fontes, estados, hashes dos resultados financeiros por variante e contagens de paridade/contraste. Os dados financeiros são inteiramente sintéticos.

O ZIP entregue fora do Git contém todas as capturas, PDFs, renderizações, textos extraídos, JSONs financeiros, provas de apresentação quando necessárias, logs, snapshots e fontes auditadas. `index.json` relaciona cada entrada a seu tamanho e SHA-256; seu próprio hash consta do resumo. O ZIP foi reaberto para verificar CRC e todos os hashes do índice.

Os hashes dos consumidores, CSS e fixtures de cada suíte foram conferidos contra a versão final. O hash do script de automação foi registrado ao encerrar cada suíte; esse script evoluiu durante o lote para incorporar cenários independentes. Os manifestos completos conservam esses registros originais, e o pacote inclui o runner final para reprodução.

Para conferir o arquivo recebido, executar `Get-FileHash finelo-ciclo-3c-evidencias.zip -Algorithm SHA256` e comparar com `summary.json`. O índice dentro do ZIP deve ser idêntico a este índice versionado. Os detalhes metodológicos, limites e comandos de reprodução estão na [seção 3C do relatório](../ciclo-3-telas-financeiras.md#lote-3c--cartões-faturas-e-pagamentos).

As variantes são main `6fa1188`, revisado `3e73415`, Escuro atual e Claro atual; as larguras são 1440 e 390 pixels. Não há conta, transação real, sessão de produção ou alteração de coorte nestas evidências. A impressão existente é preservada, incluindo suas exclusões legadas; a bateria não cria um novo relatório de faturas.
