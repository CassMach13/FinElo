# Sprint 2C — ativação atômica da projeção do cartão

## Objetivo

Transformar uma auditoria sombra compatível em uma troca indivisível da projeção normalizada do cartão. A Sprint 2C não corrige dados históricos e não cria ou exclui lançamentos financeiros.

## Guardas obrigatórias

- Kill switch individual em `auth.users.raw_app_meta_data.atomic_card_rebuild_enabled`; o padrão é desligado.
- Dupla leitura de revisão durante a auditoria para rejeitar uma fotografia inconsistente.
- Nova auditoria imediatamente antes da ativação.
- Lock transacional por conta e comparação da revisão no banco.
- Conjuntos de faturas, itens e pagamentos devem coincidir exatamente; qualquer linha ausente, órfã, duplicada ou sem identidade bloqueia a operação.
- A operação atualiza somente linhas existentes.
- Totais e competências são validados em centavos.
- Metadados manuais e totais originais do arquivo são preservados.
- O snapshot é imutável para o cliente e só pode ser usado pela função de rollback.

## Separação entre evidência e conciliação

`statement_total_from_file` e `total_payments_from_file` continuam preservados para auditoria. Após uma ativação validada (`atomic_projection_version = 1`), eles não substituem a conciliação ativa calculada pela projeção. Ajustes manuais continuam tendo prioridade.

## Rollback individual

Cada ativação salva, na mesma transação, os campos mutáveis anteriores de faturas, itens e pagamentos. O rollback só é aceito se a revisão atual ainda for exatamente a revisão produzida pela ativação; assim, nenhuma alteração legítima posterior é sobrescrita. A restauração precisa reproduzir o checksum de revisão anterior ou toda a transação é cancelada.

## Escopo de homologação

1. Aplicar a migration `062` somente no staging.
2. Habilitar o kill switch apenas para a conta sintética autorizada.
3. Auditar e registrar contagens antes da ativação.
4. Ativar a projeção e verificar contagens, competências, pagamentos e centavos.
5. Confirmar que os totais de arquivo permanecem visíveis como evidência.
6. Executar rollback pelo snapshot e confirmar a revisão original.
7. Repetir a ativação e testar uma alteração concorrente; o rollback deve ser recusado.

## Produção

Esta branch não autoriza migration, merge, deployment nem habilitação em produção. Uma futura aprovação deve incluir backup validado, deployment escuro, piloto individual, monitoramento e caminho de rollback.
