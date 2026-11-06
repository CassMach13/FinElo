# Evidências compactas — 4D-R2B

**NO-GO. Produto sem alterações.** O laboratório não é uma integração publicada do FinElo.

- [Relatório e matrizes completas](../ciclo-4d-r2b-estrategia-migracao.md).
- Diffs de referência: [interface](../proposta-r2b-interface.patch), [worker](../proposta-r2b-worker.patch), [migração e harness](../proposta-r2b-migracao.patch). Adicionam somente arquivos de diagnóstico; não aplicar como patch de produto.
- `metrics.json`: 70/70 PASS na bateria final cooperativa, auditoria financeira 70/70; legado com 24 PASS/16 FAIL residuais em quatro sessões/40 passos; tentativas anteriores preservadas.
- `manifest.json`: CRC, SHA-256, tamanho e objetos do pacote completo externo; hashes das três capturas compactas.

As capturas mostram B no laboratório sintético e um antes/depois do **legado** com `LEGACY_INITIATOR`. O botão antigo perde o formulário por seu timer, enquanto o worker B permanece esperando; esse estado é comprovado no JSON nativo, não apenas pela imagem. Todas as capturas foram inspecionadas. Os primeiros passos legados usam 390×844; a gravação observada é testada em desktop 1440×1000. Não há homologação de acessibilidade mobile ou de aparelho.

As tentativas sem confirmação de freeze permanecem FAIL; emulação CDP de scripts desabilitados e injeção de evento de lifecycle são identificadas separadamente e não homologam suspensão física. O resultado 68/2 anterior e os dois reensaios PASS não foram substituídos por um agregado: houve uma nova bateria completa 70/70 sobre o artefato final.

O ZIP externo preserva fontes por execução, matrizes, recibos, recursos imutáveis R1 e logs sintéticos higienizados. Não inclui perfis de navegador, `.env`, credenciais ou faturas privadas. Os hashes e FAILs históricos R1/R2 permanecem intactos. Não houve merge, comando de deploy, migration, coorte nova ou Claro global.
