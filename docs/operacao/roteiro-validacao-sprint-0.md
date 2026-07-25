# Roteiro de validação — Sprint 0

## Escopo

A Sprint 0 não altera telas, regras financeiras, banco ou experiência dos usuários. A validação é
técnica e operacional.

## Resultado esperado

- O aplicativo continua compilando.
- Os 109 testes existentes continuam passando.
- O baseline aceita exatamente os 17 diagnósticos TypeScript conhecidos.
- Um diagnóstico TypeScript novo faz a verificação falhar.
- Nenhum segredo real é necessário para o workflow.
- Nenhuma migration ou chamada remota é executada.

## Comandos

```bash
npm ci
npm run typecheck:baseline
npm test
npm run build
```

## Teste de proteção do baseline

Este teste deve ser feito apenas na branch de trabalho:

1. Introduzir temporariamente um erro de tipo em um arquivo de teste.
2. Executar `npm run typecheck:baseline`.
3. Confirmar que o comando falha e lista o diagnóstico como novo.
4. Reverter somente essa alteração temporária.
5. Executar novamente e confirmar que o baseline passa.

Não atualizar `typescript-errors.txt` para aceitar o erro temporário.

## Aprovação do responsável pelo produto

Como não há mudança funcional, a conta demo não precisa ser utilizada nesta Sprint.

Antes de qualquer Sprint funcional, o responsável receberá um roteiro separado com:

- preparação da conta demo;
- arquivos de entrada;
- valores esperados;
- casos de erro;
- verificação visual;
- consultas de validação;
- retorno.

## Retorno em caso de recusa

Se a Sprint 0 for recusada:

1. não fazer merge da branch `codex/sprint-0-safety-baseline`;
2. não publicar deployment;
3. não aplicar migrations;
4. retornar à `main`, que permanece no commit anterior;
5. preservar as alterações locais do usuário fora dos commits da Sprint.
