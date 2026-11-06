# Evidências compactas — 4D-R2

**NO-GO. Não há implementação R2 aplicada ao produto.** A etapa 3 exige autorização separada para mudar a política de ativação do worker. O relatório distingue baseline, proposta isolada e testes ainda pendentes.

- [Relatório/contrato e limites](../ciclo-4d-r2-atualizacao-segura.md).
- [Patch separado, parcial e não aplicado](../proposta-fronteira-worker-4d-r2.patch).
- `metrics.json`: contagens reais, FAILs e limites de cada execução; testes unitários da proposta não equivalem a aceitação do produto.
- `manifest.json`: pacote externo, CRC, SHA-256 de cada objeto, tamanho e hashes das capturas.
- `inventario-estados.json`: busca mecânica de observabilidade; inclui candidatos/falsos positivos e não certifica cobertura de todos os handlers.

As duas capturas `r2-boundary-chrome-original-before.png` / `after.png` mostram o mesmo perfil descartável, viewport 390×844, Claro, com a versão A instalada sob `skipWaiting:true`. A fonte de A é imutável. B usa **worker experimental com prefixo de negação**, não o worker de release. Mesmo sem B ativar, o botão antigo agenda seu reload local e o formulário da aba iniciadora desaparece. O JSON relaciona documentos/runtime A e B ainda esperando; a captura sozinha não comprova estado de worker.

No ensaio extra, nenhum rascunho é cancelado antes do clique. Isso difere do cenário `single-reopened-offline` do baseline R1, que fecha o formulário com Escape antes de confirmar. O contraexemplo novo não pode ser ocultado pelo PASS daquele cenário anterior.

O pacote externo contém a matriz nativa completa, hashes dos quatro builds históricos, os quatro ensaios extras e fontes/recibos necessários para reprodução. Não inclui perfis de navegador, credenciais, `.env`, faturas privadas ou dados reais. Nenhuma evidência anterior foi sobrescrita. Execuções em desktop headless não homologam instalação no sistema operacional ou dispositivos físicos.
