'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Página de destino do link de convite (ADR-008, fatia 2). O e-mail do Supabase Auth
 * traz um token na URL; o supabase-js estabelece a sessão automaticamente
 * (`detectSessionInUrl`). Aqui o convidado define a senha (`updateUser`) e entra na loja.
 * Também serve para "recuperação de senha" (mesmo mecanismo do Supabase).
 */
export default function DefinirSenhaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // A sessão pode vir do hash da URL (evento) ou já estar resolvida ao montar.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('A senha deve ter ao menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('A confirmação não confere com a senha.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.replace('/venda'), 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold">NexoLoja</h1>
        <p className="mb-6 text-sm text-gray-500">Defina sua senha de acesso</p>

        {!ready ? (
          <p className="text-sm text-gray-500">Validando o convite…</p>
        ) : !hasSession ? (
          <div className="space-y-3 text-sm">
            <p className="text-red-600">
              Link inválido ou expirado. Peça ao administrador da loja um novo convite.
            </p>
            <button
              onClick={() => router.replace('/login')}
              className="text-gray-600 underline hover:text-gray-900"
            >
              Ir para o login
            </button>
          </div>
        ) : done ? (
          <p className="text-sm text-green-600">Senha definida! Entrando…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                Confirmar senha
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Definir senha e entrar'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
