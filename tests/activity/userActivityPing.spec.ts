import { describe, expect, it } from 'vitest';
import {
  INTERVALO_MINIMO_MS,
  criarControleDeEnvio,
  devePedirRegistro,
  ultimaAtividadeExibida,
} from '../../src/domain/activity/userActivityPing';

/**
 * Chamado 20260903-44F1: "o CRM não mostra o último acesso corretamente,
 * diversos usuários acessam e nunca atualiza".
 *
 * A causa era a fonte: `last_sign_in_at` só se move num login de verdade, e
 * quem fica logado nunca gera um novo. Agora a aplicação registra a própria
 * atividade — e este módulo decide quando pedir esse registro.
 *
 * A garantia dos 30 minutos é do servidor, no comando de gravação, valendo
 * para todas as abas ao mesmo tempo. O que se testa aqui é a economia de
 * chamadas e a regra de exibição.
 */

const MEIA_HORA = INTERVALO_MINIMO_MS;

describe('quando pedir o registro de atividade', () => {
  it('1. a primeira vez sempre pede', () => {
    expect(devePedirRegistro(1_000_000, null)).toBe(true);
  });

  it('2. dentro dos 30 minutos não pede de novo', () => {
    const agora = 1_000_000;
    expect(devePedirRegistro(agora + MEIA_HORA - 1, agora)).toBe(false);
    expect(devePedirRegistro(agora + 1, agora)).toBe(false);
  });

  it('3. exatamente nos 30 minutos já pede', () => {
    const agora = 1_000_000;
    expect(devePedirRegistro(agora + MEIA_HORA, agora)).toBe(true);
  });

  it('depois dos 30 minutos pede', () => {
    const agora = 1_000_000;
    expect(devePedirRegistro(agora + MEIA_HORA + 1, agora)).toBe(true);
  });

  it('a janela é de 30 minutos, não outra coisa', () => {
    expect(INTERVALO_MINIMO_MS).toBe(30 * 60 * 1000);
  });
});

describe('o controle por aba', () => {
  it('pede na primeira vez e cala na segunda', () => {
    const controle = criarControleDeEnvio();
    const t0 = 5_000_000;

    expect(controle.devePedirRegistro(t0)).toBe(true);
    controle.registrarEnvio(t0);

    expect(controle.devePedirRegistro(t0 + 60_000)).toBe(false);
    expect(controle.devePedirRegistro(t0 + MEIA_HORA)).toBe(true);
  });

  it('muitos eventos seguidos geram um único envio', () => {
    // A aba ganhando foco várias vezes em poucos minutos é o caso comum.
    const controle = criarControleDeEnvio();
    const t0 = 5_000_000;
    let enviados = 0;

    for (const minuto of [0, 1, 2, 5, 10, 20, 29]) {
      const agora = t0 + minuto * 60_000;
      if (controle.devePedirRegistro(agora)) {
        controle.registrarEnvio(agora);
        enviados += 1;
      }
    }

    expect(enviados).toBe(1);
  });

  it('cada aba tem sua própria memória — por isso o servidor é a autoridade', () => {
    const aba1 = criarControleDeEnvio();
    const aba2 = criarControleDeEnvio();
    const t0 = 5_000_000;

    aba1.registrarEnvio(t0);

    expect(aba1.devePedirRegistro(t0 + 60_000)).toBe(false);
    // A aba 2 não sabe da aba 1 e vai pedir. O servidor descarta.
    expect(aba2.devePedirRegistro(t0 + 60_000)).toBe(true);
  });
});

describe('o que o CRM exibe como última atividade', () => {
  it('5. usa a atividade registrada quando existe', () => {
    expect(
      ultimaAtividadeExibida({
        last_activity_at: '2026-09-04T11:00:00Z',
        last_sign_in_at: '2026-07-30T18:00:00Z',
      })
    ).toBe('2026-09-04T11:00:00Z');
  });

  it('6. usuário antigo sem atividade cai no último login', () => {
    expect(
      ultimaAtividadeExibida({ last_activity_at: null, last_sign_in_at: '2026-07-30T18:00:00Z' })
    ).toBe('2026-07-30T18:00:00Z');
  });

  it('quem nunca entrou não tem o que exibir', () => {
    expect(ultimaAtividadeExibida({ last_activity_at: null, last_sign_in_at: null })).toBeNull();
  });

  it('a atividade vence o login mesmo sendo mais antiga — não se escolhe a maior data', () => {
    // O login pode ser mais recente que a última atividade registrada (alguém
    // que acabou de logar e ainda não teve o ping gravado). Ainda assim o
    // campo de atividade é a fonte: inventar um "máximo" aqui esconderia
    // defeito no registro em vez de mostrá-lo.
    expect(
      ultimaAtividadeExibida({
        last_activity_at: '2026-01-01T00:00:00Z',
        last_sign_in_at: '2026-09-04T00:00:00Z',
      })
    ).toBe('2026-01-01T00:00:00Z');
  });
});
