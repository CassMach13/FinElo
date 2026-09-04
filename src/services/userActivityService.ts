import { supabase } from '../supabaseClient';
import { criarControleDeEnvio } from '../domain/activity/userActivityPing';

/**
 * Registra que este usuário está usando o produto agora.
 *
 * Silencioso de propósito: é telemetria operacional, não uma ação do usuário.
 * Se falhar — offline, sessão expirada, rede instável — não há nada a fazer e
 * nada a mostrar. O pior caso é o CRM ficar um pouco defasado, que é
 * exatamente o estado anterior a esta funcionalidade.
 *
 * O intervalo mínimo de 30 minutos é garantido pelo servidor. O controle daqui
 * só evita a chamada de rede quando ela seria descartada de qualquer forma.
 */
const controle = criarControleDeEnvio();

export function registrarAtividadeDoUsuario(): void {
  if (!controle.devePedirRegistro()) return;
  controle.registrarEnvio();

  void supabase.rpc('touch_user_activity').then(({ error }) => {
    if (error) {
      // Sem console.error: não é problema do usuário e não exige ação dele.
      console.debug('[Atividade] não registrada:', error.message);
    }
  });
}

/** Só para teste: descarta a memória de envio desta aba. */
export function esquecerUltimoEnvioDeAtividade(): void {
  controle.esquecer();
}
