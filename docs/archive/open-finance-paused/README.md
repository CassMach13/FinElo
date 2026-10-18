# Open Finance pausado — arquivo não executável

Decisão de produto: Belvo e Pluggy estão pausados por custo.

Os cinco arquivos `.js.disabled` preservam o conteúdo das implementações da main, em UTF-8/LF,
`224f608dfde41a97229b4baca22ee4ff75020e18`. O trecho do antigo proxy Vite foi
preservado com finais de linha normalizados para LF. Os hashes constam de
[source-manifest.json](source-manifest.json).

Este diretório fica fora de `api/` e de `public/`. Nenhum entrypoint o importa.
Os arquivos são referência histórica, **não implementações aprovadas para reativação**:
preservam inclusive as lacunas de autenticação e propriedade do código anterior.

Não renomear, importar, copiar para `api/`, habilitar por flag nem usar como fallback.
Uma retomada exige decisão de produto e revisão independente de segurança.

Atributos de whitespace se aplicam somente aos snapshots .disabled, para
preservar a formatação original sem introduzir falsos erros no diff-check.
