import { describe, expect, it } from 'vitest';
import {
  TAMANHO_MAXIMO_NOME,
  metadadosDeCadastro,
  normalizarNome,
  validarNomeDeCadastro,
} from '../../src/domain/auth/signupProfile';

/**
 * Chamado 20260903-44F1, parte B: "conseguir o nome completo do usuário para
 * não ficar sem nome".
 *
 * Quem entra pelo Google chega com nome; quem se cadastra por e-mail não
 * chegava com nada, porque o formulário não perguntava. Medido na base real:
 * dos 32 usuários, os 19 cadastrados por e-mail estavam TODOS sem nome.
 */

describe('validação do nome', () => {
  it('nome comum passa', () => {
    expect(validarNomeDeCadastro('Marcelo')).toBeNull();
    expect(validarNomeDeCadastro('Ana Paula Souza')).toBeNull();
  });

  it('vazio não passa, e a mensagem diz o que fazer', () => {
    expect(validarNomeDeCadastro('')).toBe('Informe seu nome.');
    expect(validarNomeDeCadastro('   ')).toBe('Informe seu nome.');
  });

  it('uma letra só não passa', () => {
    expect(validarNomeDeCadastro('M')).toBe('Informe um nome com pelo menos 2 letras.');
  });

  it('nome absurdamente longo não passa', () => {
    const gigante = 'a'.repeat(TAMANHO_MAXIMO_NOME + 1);
    expect(validarNomeDeCadastro(gigante)).toBe('Use um nome mais curto (até 80 caracteres).');
  });

  it('exatamente no limite ainda passa', () => {
    expect(validarNomeDeCadastro('a'.repeat(TAMANHO_MAXIMO_NOME))).toBeNull();
  });

  it('não exige sobrenome — é "Nome", não nome legal', () => {
    // Exigir sobrenome criaria atrito no cadastro por um rigor que o produto
    // não usa para nada.
    expect(validarNomeDeCadastro('Bia')).toBeNull();
  });

  it('aceita acento e caracteres de nomes brasileiros', () => {
    expect(validarNomeDeCadastro('Conceição D\'Ávila')).toBeNull();
    expect(validarNomeDeCadastro('João')).toBeNull();
  });
});

describe('normalização', () => {
  it('apara espaços das pontas', () => {
    expect(normalizarNome('  Marcelo  ')).toBe('Marcelo');
  });

  it('colapsa espaços internos repetidos', () => {
    // Senão "Maria   Silva" e "Maria Silva" viram dois nomes diferentes no CRM.
    expect(normalizarNome('Maria   Silva')).toBe('Maria Silva');
  });

  it('não mexe em maiúsculas nem remove acento', () => {
    expect(normalizarNome('João DA SILVA')).toBe('João DA SILVA');
  });
});

describe('o que vai para o signUp', () => {
  it('grava em full_name — o mesmo endereço que o Google já usa', () => {
    // É o campo que o CRM lê hoje (raw_user_meta_data.full_name). Usar outro
    // exigiria coluna nova e ramificaria a leitura por origem de cadastro.
    expect(metadadosDeCadastro('Marcelo')).toEqual({ full_name: 'Marcelo' });
  });

  it('envia o nome já normalizado', () => {
    expect(metadadosDeCadastro('  Ana   Paula  ')).toEqual({ full_name: 'Ana Paula' });
  });

  it('não envia mais nada além do nome', () => {
    // Sem WhatsApp, sem telefone: não há finalidade definida para esses dados.
    expect(Object.keys(metadadosDeCadastro('Marcelo'))).toEqual(['full_name']);
  });
});
