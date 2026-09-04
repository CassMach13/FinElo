/**
 * O nome informado no cadastro por e-mail.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 *
 * Quem entra pelo Google chega com nome, porque o provedor entrega. Quem se
 * cadastra por e-mail não chegava com nada: o formulário não perguntava, e o
 * `signUp` mandava só e-mail e senha. Resultado medido na base real: dos 32
 * usuários, os 12 do Google tinham nome e os 19 cadastrados por e-mail
 * estavam TODOS sem — o CRM mostrava "Usuário sem nome" para eles.
 *
 * ===========================================================================
 * ONDE O NOME É GUARDADO
 * ===========================================================================
 *
 * Em `raw_user_meta_data.full_name`, via `options.data.full_name` do `signUp`.
 * Não é escolha estética: é exatamente onde o login do Google já grava e onde
 * o CRM já lê. Usar o mesmo endereço significa nenhuma coluna nova, nenhuma
 * tabela nova e nenhuma ramificação entre "nome de quem entrou pelo Google" e
 * "nome de quem entrou por e-mail".
 *
 * ===========================================================================
 * É "NOME", NÃO "NOME COMPLETO"
 * ===========================================================================
 *
 * Pede-se como a pessoa quer ser chamada. Não é nome legal, não é validado
 * contra documento e não precisa ter sobrenome — exigir isso criaria atrito no
 * cadastro em troca de um rigor que o produto não usa para nada.
 *
 * Usuários antigos não são tocados: nada é preenchido para trás, nada é
 * inferido a partir do e-mail.
 */

/** Comprimento mínimo depois de aparar espaços. */
export const TAMANHO_MINIMO_NOME = 2;

/** Limite defensivo: nome é identificação, não campo de texto livre. */
export const TAMANHO_MAXIMO_NOME = 80;

/**
 * O nome pronto para gravar: espaços das pontas removidos e espaços internos
 * repetidos colapsados, para "Maria   Silva" não virar dois nomes diferentes
 * de "Maria Silva" no CRM.
 */
export function normalizarNome(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ');
}

/**
 * Diz o que está errado com o nome, ou `null` se estiver bom.
 *
 * A mensagem é a que o usuário lê, então fala do que fazer — não do que a
 * validação achou.
 */
export function validarNomeDeCadastro(nome: string): string | null {
  const normalizado = normalizarNome(nome);

  if (normalizado.length === 0) return 'Informe seu nome.';
  if (normalizado.length < TAMANHO_MINIMO_NOME) return 'Informe um nome com pelo menos 2 letras.';
  if (normalizado.length > TAMANHO_MAXIMO_NOME) return 'Use um nome mais curto (até 80 caracteres).';

  return null;
}

/**
 * Os metadados enviados ao `signUp`.
 *
 * Só o nome. Nada de telefone, WhatsApp ou qualquer outro dado — coletar sem
 * finalidade definida seria pedir informação que não se sabe usar.
 */
export function metadadosDeCadastro(nome: string): { full_name: string } {
  return { full_name: normalizarNome(nome) };
}
