'use client';

import { useState } from 'react';
import { formatPhoneBr, onlyDigits } from '@nexoloja/shared';
import { apiPatch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Me } from '@/lib/useMe';

/**
 * Painel "Meus dados": o próprio usuário edita nome/telefone (via `PATCH /me`) e troca a
 * senha (via Supabase Auth no cliente, com reautenticação — pede a senha atual). O e-mail
 * é a identidade de login (auth.users): exibido, não editável.
 */
export function ProfileModal({
  me,
  onClose,
  onUpdated,
}: {
  me: Me;
  onClose: () => void;
  onUpdated: (me: Me) => void;
}) {
  // --- Dados pessoais ---
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(formatPhoneBr(me.phone));
  const [savingData, setSavingData] = useState(false);
  const [dataMsg, setDataMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Troca de senha ---
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveData(e: React.FormEvent) {
    e.preventDefault();
    setDataMsg(null);
    if (!name.trim()) {
      setDataMsg({ ok: false, text: 'O nome é obrigatório.' });
      return;
    }
    setSavingData(true);
    try {
      const updated = await apiPatch<Me>('/me', {
        name: name.trim(),
        phone: onlyDigits(phone) || null,
      });
      onUpdated(updated);
      setName(updated.name);
      setPhone(formatPhoneBr(updated.phone));
      setDataMsg({ ok: true, text: 'Dados atualizados.' });
    } catch (err) {
      setDataMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSavingData(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (next.length < 6) {
      setPwdMsg({ ok: false, text: 'A nova senha deve ter ao menos 6 caracteres.' });
      return;
    }
    if (next !== confirm) {
      setPwdMsg({ ok: false, text: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setSavingPwd(true);
    try {
      // Reautenticação: confirma a senha atual antes de permitir a troca.
      const reauth = await supabase.auth.signInWithPassword({
        email: me.email,
        password: current,
      });
      if (reauth.error) {
        setPwdMsg({ ok: false, text: 'Senha atual incorreta.' });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        setPwdMsg({ ok: false, text: error.message });
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setPwdMsg({ ok: true, text: 'Senha alterada com sucesso.' });
    } catch (err) {
      setPwdMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSavingPwd(false);
    }
  }

  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Meus dados</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={saveData} className="space-y-4">
          <div>
            <label htmlFor="me-name" className="block text-sm font-medium text-gray-700">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="me-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="me-phone" className="block text-sm font-medium text-gray-700">
              Telefone
            </label>
            <input
              id="me-phone"
              type="text"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(onlyDigits(e.target.value).slice(0, 11))}
              onBlur={() => setPhone(formatPhoneBr(phone))}
              maxLength={20}
              placeholder="Só números (ex.: 11987654321)"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">E-mail</label>
            <input value={me.email} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
            <p className="mt-1 text-xs text-gray-400">O e-mail de acesso não pode ser alterado aqui.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingData}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingData ? 'Salvando…' : 'Salvar dados'}
            </button>
            {dataMsg && (
              <span className={`text-sm ${dataMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {dataMsg.text}
              </span>
            )}
          </div>
        </form>

        <hr className="my-6 border-gray-200" />

        <form onSubmit={changePassword} className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Trocar senha</h3>
          <div>
            <label htmlFor="pwd-current" className="block text-sm font-medium text-gray-700">
              Senha atual
            </label>
            <input
              id="pwd-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pwd-new" className="block text-sm font-medium text-gray-700">
              Nova senha
            </label>
            <input
              id="pwd-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pwd-confirm" className="block text-sm font-medium text-gray-700">
              Confirmar nova senha
            </label>
            <input
              id="pwd-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingPwd || !current || !next || !confirm}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {savingPwd ? 'Trocando…' : 'Trocar senha'}
            </button>
            {pwdMsg && (
              <span className={`text-sm ${pwdMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {pwdMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
