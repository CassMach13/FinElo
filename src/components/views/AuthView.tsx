import React, { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import Button from '../ui/Button';
import { GoogleIcon, GithubIcon, EyeIcon, EyeSlashIcon } from '../ui/icons';
import Input from '../ui/Input';

// Combina a declaração da função com a exportação padrão.
export default function AuthView(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(searchParams.get('view') === 'signup');
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Sincroniza se o usuário mudar a URL manualmente ou voltar
  useEffect(() => {
    const view = searchParams.get('view');
    const emailParam = searchParams.get('email');
    
    if (view === 'signup') setIsSignUp(true);
    if (view === 'login') setIsSignUp(false);
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  const getRedirectUrl = (path: string) => {
    const url = new URL(path, window.location.origin);
    const params = new URLSearchParams(window.location.search);
    const promo = params.get('promo') || params.get('coupon');
    if (promo) url.searchParams.set('promo', promo);
    return url.toString();
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null); setMessage(null); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else {
      const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
      window.location.assign(returnTo?.startsWith('/') ? returnTo : '/app');
    }
    setLoading(false);
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null); setMessage(null); setLoading(true);

    if (password !== confirmPassword) {
      setError('As senhas não conferem.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getRedirectUrl('/app'),
      },
    });

    if (data.user && !error) {
      // Notificar Admin (Silenciosamente)
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(err => console.error('Failed to notify admin', err));
    }

    if (error) {
      // Lógica inteligente: Verifica se o erro é de usuário já existente.
      if (error.message.includes('User already registered')) {
        setError('Este e-mail já está cadastrado. Tente fazer login ou clique em "Esqueceu sua senha?".');
      } else {
        setError(error.message);
      }
    } else if (data.user && !data.user.recovery_sent_at) {
      // SUCESSO REAL: O usuário é novo.
      // A propriedade `recovery_sent_at` não existe para um cadastro novo.
      setMessage('Cadastro realizado! Verifique sua caixa de entrada para confirmar seu e-mail.');
      setEmail(''); setPassword(''); setConfirmPassword('');
    } else {
      // "FALSO SUCESSO": O usuário já existia.
      // A presença de `recovery_sent_at` na resposta do signUp indica que o Supabase
      // encontrou uma conta existente e enviou um e-mail de segurança para ela.
      setError('Este e-mail já está cadastrado. Tente fazer login ou clique em "Esqueceu sua senha?".');
    }
    setLoading(false);
  };

  // Nova função para recuperação de senha
  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null); setMessage(null); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getRedirectUrl('/update-password'),
    });
    if (error) setError(error.message);
    else setMessage('Se o e-mail estiver correto, você receberá um link para redefinir sua senha.');
    setLoading(false);
  };

  // Aceita 'google' ou 'github' agora
  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // de pular do ambiente de desenvolvimento para o de produção.
        redirectTo: getRedirectUrl('/app')
      }
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-[#0B1120] relative overflow-hidden px-4">

      {/* Background Blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none opacity-40" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none opacity-40" />

      <div className="w-full max-w-sm relative z-10 flex flex-col justify-center h-full"> {/* Flex column para centralizar verticalmente */}

        {/* Cabeçalho Compacto */}
        <div className="text-center mb-4">
          <Link 
            to="/" 
            className="inline-flex items-center justify-center w-32 h-32 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600/50 shadow-2xl mb-2 overflow-hidden ring-4 ring-slate-800/50 transform hover:scale-105 transition-all duration-500 hover:shadow-cyan-500/20"
            title="Voltar ao site"
          >
            <img src="/logo/Image_fx.png" alt="FinElo" className="w-full h-full object-cover transform scale-125" />
          </Link>
        </div>

        {/* Card Super Compacto */}
        <div className="backdrop-blur-md bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 shadow-2xl ring-1 ring-white/5">

          {isForgotPassword ? (
            // --- TELA DE RECUPERAÇÃO DE SENHA ---
            <div>
              <h2 className="text-sm font-medium text-slate-400 mb-5 text-center uppercase tracking-wider">
                Recuperar Senha
              </h2>
              <p className="text-center text-slate-400 text-xs mb-6">
                Digite seu e-mail e enviaremos um link para você voltar a acessar sua conta.
              </p>
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <Input
                  label="Email"
                  id="email"
                  type="email"
                  placeholder="nome@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="py-2.5 text-sm"
                />
                <Button type="submit" variant="primary" className="w-full h-10 mt-2 text-sm" disabled={loading}>
                  {loading ? 'Enviando...' : 'Enviar Link de Recuperação'}
                </Button>
              </form>
              <p className="text-center mt-6 text-slate-500 text-xs flex flex-col gap-3">
                <div>
                  Lembrou a senha?
                  <button
                    onClick={() => { setIsForgotPassword(false); setError(null); setMessage(null); }}
                    className="ml-1.5 text-cyan-400 hover:text-cyan-300 font-bold transition-colors hover:underline"
                  >
                    Voltar para o login
                  </button>
                </div>
                <div className="pt-2 border-t border-slate-800/50">
                  <Link to="/" className="text-slate-600 hover:text-slate-400 transition-colors">
                    Voltar ao início
                  </Link>
                </div>
              </p>

              {/* Mensagens Compactas (movidas para cá) */}
              {(message || error) && (
                <div className={`mt-4 p-2.5 rounded-lg text-xs text-center font-medium ${message ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                  {message || error}
                </div>
              )}
            </div>
          ) : (
            // --- TELA DE LOGIN / CADASTRO ---
            <div>
              <h2 className="text-sm font-medium text-slate-400 mb-5 text-center uppercase tracking-wider">
                {isSignUp ? 'Criar Conta' : 'Acessar Conta'}
              </h2>
              {/* Adicionado um <div> para agrupar todo o conteúdo abaixo do título */}
              <div>
                <div className="space-y-4">

                  {/* GRID DE BOTÕES - COM ÍCONES TRAVADOS */}
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      // h-10 fixa a altura. text-xs deixa o texto delicado.
                      className="w-full h-10 flex items-center justify-center gap-2 px-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border-slate-700 rounded-lg transition-all hover:scale-[1.02]"
                      onClick={() => handleOAuthLogin('google')}
                      disabled={loading}
                    >
                      {/* WRAPPER ESSENCIAL: Impede que o ícone cresça */}
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        <GoogleIcon className="w-full h-full" />
                      </div>
                      <span>Google</span>
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full h-10 flex items-center justify-center gap-2 px-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border-slate-700 rounded-lg transition-all hover:scale-[1.02]"
                      onClick={() => handleOAuthLogin('github')}
                      disabled={loading}
                    >
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        <GithubIcon className="w-full h-full" />
                      </div>
                      <span>GitHub</span>
                    </Button>
                  </div>

                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-slate-800"></div>
                    <span className="flex-shrink-0 mx-3 text-[10px] font-bold text-slate-600 uppercase">ou</span>
                    <div className="flex-grow border-t border-slate-800"></div>
                  </div>

                  <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-3">
                    <Input
                      label="Email"
                      id="email"
                      type="email"
                      placeholder="nome@exemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      // Padding reduzido (py-2.5) e texto menor (text-sm)
                      className="py-2.5 text-sm"
                    />
                    <div className="relative">
                      <Input
                        label="Senha"
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                        className="py-2.5 text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 top-6 flex items-center pr-3 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                      </button>
                    </div>

                    {isSignUp && (
                      <div className="relative">
                        <Input
                          label="Confirmar Senha"
                          id="confirmPassword"
                          type={showPassword ? 'text' : 'password'} // Usa a mesma visibilidade da senha
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={loading}
                          className="py-2.5 text-sm pr-10"
                        />
                      </div>
                    )}

                    <Button type="submit" variant="primary" className="w-full h-10 mt-2 text-sm" disabled={loading}>
                      {loading ? 'Carregando...' : (isSignUp ? 'Cadastrar' : 'Entrar')}
                    </Button>
                  </form>

                  {!isSignUp && (
                    <div className="text-center mt-4">
                      <button
                        onClick={() => { setIsForgotPassword(true); setError(null); setMessage(null); }}
                        className="text-xs text-slate-500 hover:text-cyan-400 transition-colors hover:underline"
                      >
                        Esqueceu sua senha?
                      </button>
                    </div>
                  )}
                </div>

                {/* Mensagens Compactas (movidas para cá) */}
                {(message || error) && (
                  <div className={`mt-4 p-2.5 rounded-lg text-xs text-center font-medium ${message ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {message || error}
                  </div>
                )}

                {/* Link para alternar entre Login e Cadastro (movido para cá) */}
                <div className="text-center mt-6 text-slate-500 text-xs flex flex-col gap-3">
                  <div>
                    {isSignUp ? 'Já tem uma conta?' : 'Não tem uma conta?'}
                    <button
                      onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null); }}
                      className="ml-1.5 text-cyan-400 hover:text-cyan-300 font-bold transition-colors hover:underline"
                    >
                      {isSignUp ? 'Entrar' : 'Criar'}
                    </button>
                  </div>
                  <div className="pt-2 border-t border-slate-800/50">
                    <Link to="/" className="text-slate-600 hover:text-slate-400 transition-colors">
                      Voltar ao início
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] text-slate-700 pointer-events-none">v0.0.1</div>
    </div>
  );
};
