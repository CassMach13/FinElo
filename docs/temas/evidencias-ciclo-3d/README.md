# Evidências compactas — lote 3D

Seis PNGs com pares Escuro/Claro, mesmos dados/estado/dimensões:

- `desktop-{dark,light}-confirmacao-bank_adjustment.png` — confirmação da classificação.
- `mobile-{dark,light}-estado-positive.png` — seleção e campos nativos.
- `mobile-{dark,light}-entrada-diagnostico.png` — entrada real pelo diagnóstico de cartão.

`summary.json` registra métricas e SHA-256/tamanho do ZIP externo `finelo-ciclo-3d-evidencias.zip`. Os manifestos compactos conservam bases, fontes, resultados financeiros, invariantes e limitações anteriores. Os JSONs financeiros completos ficam no pacote; todos os dados de homologação da apresentação são sintéticos.

O índice versionado relaciona cada entrada do pacote a SHA-256 e tamanho. O ZIP foi reaberto: CRC e todos os hashes indexados foram conferidos. Para verificar o arquivo recebido, executar `Get-FileHash finelo-ciclo-3d-evidencias.zip -Algorithm SHA256` e comparar com `summary.json`; o índice interno deve ser idêntico a `index.json` deste diretório.

O pacote contém capturas representativas, PDFs/renderizações/textos, payloads e projeções dos dois livros, snapshots imutáveis, fontes, versões e logs. Os consumidores/CSS/fixtures de cada manifesto foram conferidos com a versão final. O hash do runner foi registrado ao encerrar cada suíte; ele evoluiu para incorporar verificações independentes. Os registros originais foram preservados e o runner final está incluído para reprodução.

Limitações de feedback de reversão recusada/timeout duplo e de rolagem mobile são anteriores à conversão, documentadas separadamente. Paridade não é aprovação desses comportamentos. Consulte o [relatório, matrizes e plano do próximo ciclo](../ciclo-3-telas-financeiras.md#lote-3d--conciliação).
