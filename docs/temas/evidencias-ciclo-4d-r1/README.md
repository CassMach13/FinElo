# Evidências compactas — 4D-R1

**NO-GO mantido. Política de produção não alterada.** [Relatório](../ciclo-4d-r1-pwa.md) · [Proposta não aplicada](../proposta-pwa-prompt-4d-r1.patch).

| Captura | Interpretação |
| --- | --- |
| [Reconstrução anterior intacta](before-old-document.png) | A aberto depois do timeout; SW/cache B comprovados no JSON |
| [Política original, página reaberta](msedge-original-original-update-ui-restored-light.png) | FAIL de aviso/atualização pela UI nessa condição |
| [Proposta isolada, Edge](msedge-proposed-prompt-original-update-ui-light.png) | B depois do botão original, preferência Claro preservada |
| [Proposta isolada, Chrome/página reaberta](chrome-proposed-prompt-original-update-ui-restored-light.png) | B, preferência e finanças preservadas |

Quatro PNGs, **285.667 bytes**. Os três frames atuais são visualmente idênticos porque não houve mudança de UI e os marcadores de versão são atributos de diagnóstico sem geometria. **A imagem sozinha não identifica a revisão**: HTML, JavaScript executado, worker, cache, cliques e hashes são comprovados pelos relatórios JSON. Não usar igualdade de pixels como prova de atualização.

[metrics.json](metrics.json): 30 grupos canônicos, **28 PASS / dois FAIL** da UI original em página reaberta; oito grupos da proposta PASS. A confirmação focal substitui somente o controle indicado e preserva sua observação anterior: um worker instrumentado chegou a `waiting` com prompt, estado não reproduzido na repetição; recuperação daquela mesma instância **NOT TESTED**, sem causa atribuída ao produto. Auth remoto **BLOCKED**, PWA instalado **NOT TESTED**.

[manifest.json](manifest.json) registra as duas verificações completas CRC/SHA e os hashes individuais. ZIP externo **`finelo-ciclo-4d-r1-evidencias.zip`**, **7.940.433 bytes**, **1.023 caminhos / 506 objetos únicos**.

- SHA-256: `85000adad08a923abe34244f7f810e702c5b0fb8b59e624fae286a7d0cdbe2a8`.
- Índice: `7ba126f9908a7f1a22082aaa90868486ad8ccec96e462eba3c8edd9d58a2d0b8`.
- Checkpoint das fontes: `1de5b472df58f8e535aa1b2c80ad921efa7c5537`; o fechamento acrescenta embalagem/documentação, sem mudar o produto.

O pacote contém reconstrução original, resultado do harness corrigido, matrizes preliminares identificadas, canários da ferramenta, conjunto final, artefatos precached A/B originais e observados, scripts, fontes de produto e overlays exatos da regressão completa. `evidence/canonical-summary.json` define o conjunto final; não somar retestes. Os workers observados acrescentam só a mensagem de revisão, com mapeamento de SHA e prefixo gerado preservado.

Excluídos: `.env`, credenciais, perfis, logs brutos, faturas privadas, vídeos e binários de dependências. Pacotes anteriores preservados. Verificação sem extração: `python scripts/diagnostics/verify-theme-evidence.py <caminho-do-zip>`. O arquivo está no diretório externo de artefatos do atendimento, não em URL pública.
