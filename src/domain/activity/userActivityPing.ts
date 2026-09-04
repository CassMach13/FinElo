/**
 * Quando pedir ao servidor para registrar atividade do usuário.
 *
 * ===========================================================================
 * O QUE ISTO RESOLVE
 * ===========================================================================
 *
 * O CRM mostrava "último acesso" lendo `last_sign_in_at`, que só se move num
 * login de verdade. Quem fica logado usa o produto por semanas sem gerar um
 * novo login, e o número congela — na base real, alguém ativo no dia aparecia
 * como inativo havia 86 dias.
 *
 * Agora a aplicação registra a própria atividade. Este módulo decide apenas
 * QUANDO vale a pena pedir esse registro.
 *
 * ===========================================================================
 * ONDE MORA A GARANTIA
 * ===========================================================================
 *
 * Não aqui. O limite de uma escrita a cada 30 minutos é imposto pelo servidor,
 * dentro do próprio comando de gravação, e por isso vale para todas as abas e
 * dispositivos ao mesmo tempo.
 *
 * O que este módulo faz é evitar a viagem de rede: sem ele, cada vez que a aba
 * ganhasse foco haveria uma chamada que o servidor descartaria. É economia,
 * não regra — e é por isso que ele pode ser simples e ficar em memória, sem
 * persistência.
 *
 * ===========================================================================
 * O QUE CONTA COMO ATIVIDADE
 * ===========================================================================
 *
 * Evidência de uso real: entrar no app autenticado, e a aba voltar a ficar
 * visível. Não é a cada render nem a cada requisição — o objetivo é medir uso
 * do produto, não movimentação de token em segundo plano.
 */

/** A mesma janela que o servidor aplica. Aqui só evita chamada inútil. */
export const INTERVALO_MINIMO_MS = 30 * 60 * 1000;

/**
 * Vale a pena chamar o servidor agora?
 *
 * @param agora        instante atual, em ms
 * @param ultimoEnvio  quando esta aba enviou pela última vez; `null` se nunca
 */
export function devePedirRegistro(agora: number, ultimoEnvio: number | null): boolean {
  if (ultimoEnvio === null) return true;
  return agora - ultimoEnvio >= INTERVALO_MINIMO_MS;
}

/**
 * Guarda em memória do último envio desta aba.
 *
 * Deliberadamente não persiste: se a aba recarregar, um envio a mais é
 * inofensivo — o servidor decide de qualquer forma.
 */
export function criarControleDeEnvio() {
  let ultimoEnvio: number | null = null;

  return {
    devePedirRegistro: (agora: number = Date.now()) => devePedirRegistro(agora, ultimoEnvio),
    registrarEnvio: (agora: number = Date.now()) => {
      ultimoEnvio = agora;
    },
    /** Só para teste: descarta a memória desta aba. */
    esquecer: () => {
      ultimoEnvio = null;
    },
  };
}

/** A data que o CRM deve exibir como "última atividade". */
export function ultimaAtividadeExibida(usuario: {
  last_activity_at?: string | null;
  last_sign_in_at?: string | null;
}): string | null {
  // Usuário antigo ainda sem atividade registrada cai no último login. É só
  // exibição: nada é preenchido para trás no banco.
  return usuario.last_activity_at ?? usuario.last_sign_in_at ?? null;
}
