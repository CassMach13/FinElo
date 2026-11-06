# Evidências compactas — 4D

**Entrega local parcial. NO-GO para iniciar piloto.** [Relatório](../ciclo-4d-homologacao-integrada.md) · [Roteiro físico/remoto](../ciclo-4d-roteiro-manual.md).

Seis PNGs, **605.053 bytes**, com os mesmos fixtures/relógio/dimensões nos pares. Nenhuma máscara ou tolerância adicional. As duas últimas imagens documentam foco e uma falha; não são pares de paridade visual.

| Amostra | Escuro | Claro |
| --- | --- | --- |
| Dashboard, Edge 1440×1000 | [Captura](edge-1440-dark-0-dashboard.png) | [Captura](edge-1440-light-0-dashboard.png) |
| Investimentos, Edge 390×844 | [Captura](edge-390-dark-3-investments.png) | [Captura](edge-390-light-3-investments.png) |

[Retorno de foco do formulário](auth-edge-modal-focus-restoration.png) · [PWA — falha do ensaio de atualização](pwa-failure.png).

[metrics.json](metrics.json) sintetiza os resultados; disponibilidade de um navegador como PASS não elimina `navigation.issues`, os FAILs de acessibilidade ou o FAIL PWA. [manifest.json](manifest.json) contém hashes individuais, índice e duas verificações completas CRC/SHA do ZIP. Auth remoto permanece BLOCKED e aparelhos/PWA instalado NOT TESTED.

Pacote externo **`finelo-ciclo-4d-evidencias.zip`**, **17.566.332 bytes**, **1.382 caminhos / 882 objetos únicos**. SHA-256 **`69925a0cfc868c0b924bf99d9378417a1b9961894a8107f39e82ec914e180bf4`**. Índice **`b514534939f04240827dc7809365a1f99e97330132dd464f62c6dd78f6a9c4a4`**.

Checkpoint das fontes de produto: **`b6929e4bbe7457575122c6dd765dfbc7c9e08f9a`**; commits posteriores deste lote acrescentam embalagem/documentação, sem mudar essas fontes. O ZIP contém os relatórios/capturas completos, 12 PDFs, seis exportações, fontes congeladas main/revisado, fontes atuais e scripts de reprodução. Relatórios preliminares permanecem explicitamente preliminares; `summary.json` e `auth-canonical.json` definem os conjuntos finais. Não soma retestes aos 36 grupos canônicos.

O pacote exclui faturas privadas, `.env`, credenciais, headers, perfis de navegador, binários de dependências e logs brutos. Pacotes anteriores não foram modificados. Para verificar sem extrair: `python scripts/diagnostics/verify-theme-evidence.py <caminho-do-zip>`. O arquivo externo fica no diretório de artefatos do atendimento; não é uma URL pública nem um deployment.
