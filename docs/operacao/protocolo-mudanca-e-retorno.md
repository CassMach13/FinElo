# Protocolo de mudança, aprovação e retorno

Este protocolo complementa `docs/finelo-production-playbook.md` e prevalece para mudanças que
possam afetar os usuários existentes.

## 1. Princípio

Uma mudança recusada não deve chegar à `main`, a um deployment de produção ou ao banco.

O retorno mais seguro é impedir a entrada da mudança, não tentar desfazê-la depois.

## 2. Isolamento por branch e commit

Cada iniciativa usa branch própria e commits pequenos.

- A branch nasce do commit aprovado da `main`.
- Alterações locais preexistentes não são adicionadas.
- O artefato testado deve corresponder ao mesmo commit que será submetido à aprovação.
- Não há merge sem aprovação.
- Se a mudança for recusada, a branch é mantida para análise ou abandonada; a `main` não muda.

## 3. Classificação de impacto

| Classe | Exemplos | Aprovação |
|---|---|---|
| A — sem mudança de runtime | documentação, testes, CI | revisão antes do merge |
| B — runtime reversível | UI isolada, feature flag desligada | conta demo + aprovação |
| C — escrita compatível | nova tabela/coluna nullable, escrita paralela | staging + backup + aprovação |
| D — reinterpretação de dados | backfill, rebuild, mudança de competência | ensaio de restauração + aprovação específica |
| E — destrutiva | delete, drop, alteração irreversível | bloqueada por padrão |

## 4. Regra para banco de dados

Rollback de aplicação não desfaz migration nem corrige dados já escritos.

Por isso:

- migrations começam aditivas;
- colunas novas são nullable ou têm default compatível;
- o código antigo continua funcionando;
- escrita nova fica atrás de feature flag;
- backfills são processos separados, limitados e auditáveis;
- nunca executar `DROP`, `DELETE` em massa ou mudança de significado na mesma entrega;
- não remover estrutura antiga até passar um período de estabilização aprovado.

Sem backup restaurável verificado, mudanças classe D e E não podem seguir para produção.

## 5. Pacote de aprovação

Antes do teste do responsável pelo produto, entregar:

- commit SHA candidato;
- escopo e arquivos alterados;
- classificação de impacto;
- tabelas e fluxos envolvidos;
- dados/fixtures de teste;
- roteiro da conta demo;
- resultados automatizados;
- consultas somente leitura de validação;
- plano de ativação;
- stop conditions;
- plano de retorno.

## 6. Se a mudança for recusada antes do merge

1. Não fazer merge.
2. Não criar/promover deployment de produção.
3. Não aplicar migration.
4. Registrar o motivo da recusa.
5. Manter a `main` no último commit aprovado.

Nenhum comando destrutivo no workspace do usuário é necessário.

## 7. Se houver falha em preview/staging

1. Desligar a feature flag no ambiente de teste.
2. Voltar o preview ao commit aprovado.
3. Preservar logs e evidências.
4. Se houve escrita em staging, restaurar o snapshot de staging ou limpar somente o lote de teste
   identificado.
5. Corrigir em novo commit; nunca reescrever o commit já testado.

## 8. Se houver falha após produção

### Aplicação

1. Desligar a feature flag, quando disponível.
2. Promover na Vercel o deployment do último commit aprovado.
3. Confirmar login, dashboard, transações, importação e cartão.

### Banco

1. Pausar o fluxo que produz novas escritas afetadas.
2. Não executar SQL de compensação improvisado.
3. Medir linhas e usuários afetados com consultas somente leitura.
4. Escolher entre correção progressiva, restauração ou replay com base no backup ensaiado.
5. Exigir nova aprovação antes de qualquer correção de dados.

## 9. Stop conditions

Interromper imediatamente o rollout quando ocorrer qualquer um:

- divergência financeira não explicada, inclusive R$ 0,01;
- aumento de falhas de login/importação;
- transação ausente ou duplicada;
- leitura ou escrita entre usuários;
- fatura divergente do arquivo;
- crescimento anormal de erros;
- necessidade de SQL manual não prevista;
- impossibilidade de identificar exatamente os registros afetados.
