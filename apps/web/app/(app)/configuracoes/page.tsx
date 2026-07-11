'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LOGO_ALLOWED_TYPES,
  LOGO_MAX_BYTES,
  formatCnpj,
  formatPhoneBr,
  onlyDigits,
  validateLogo,
} from '@nexoloja/shared';
import { apiDelete, apiGet, apiPatch, apiUpload } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { UsersSection } from './UsersSection';

type Store = {
  name: string;
  logoUrl: string | null;
  cnpj: string | null;
  phone: string | null;
};

export default function ConfiguracoesPage() {
  const { me, loading: meLoading, isAdmin } = useMe();
  const online = useOnline();
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Preview local (objectURL) enquanto o arquivo escolhido ainda não foi enviado.
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Formulário dos dados cadastrais (card "Dados da loja"), independente da logo.
  const [form, setForm] = useState({ name: '', cnpj: '', phone: '' });
  const [savingData, setSavingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataSuccess, setDataSuccess] = useState<string | null>(null);

  function fillForm(s: Store) {
    // O banco guarda só dígitos; exibimos formatado (a edição volta a dígitos no onChange).
    setForm({
      name: s.name ?? '',
      cnpj: formatCnpj(s.cnpj),
      phone: formatPhoneBr(s.phone),
    });
  }

  async function load() {
    try {
      const s = await apiGet<Store>('/tenant');
      setStore(s);
      fillForm(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSuccess(null);
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;

    // Mesma validação do servidor (ADR-007): feedback imediato ao usuário.
    const check = validateLogo(picked.type, picked.size);
    if (!check.ok) {
      setError(check.error);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }

  async function onUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { logoUrl } = await apiUpload<{ logoUrl: string }>('/tenant/logo', file);
      setStore((s) => (s ? { ...s, logoUrl } : s));
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
      setSuccess('Logo atualizada.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiDelete('/tenant/logo');
      setStore((s) => (s ? { ...s, logoUrl: null } : s));
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
      setSuccess('Logo removida.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveData(e: React.FormEvent) {
    e.preventDefault();
    setDataError(null);
    setDataSuccess(null);
    if (!form.name.trim()) {
      setDataError('O nome da loja é obrigatório.');
      return;
    }
    setSavingData(true);
    try {
      // Envia só dígitos (forma canônica); o servidor normaliza igual por garantia.
      const updated = await apiPatch<Store>('/tenant', {
        name: form.name.trim(),
        cnpj: onlyDigits(form.cnpj) || null,
        phone: onlyDigits(form.phone) || null,
      });
      setStore(updated);
      fillForm(updated);
      setDataSuccess('Dados da loja atualizados.');
    } catch (e) {
      setDataError((e as Error).message);
    } finally {
      setSavingData(false);
    }
  }

  const shownLogo = preview ?? store?.logoUrl ?? null;
  // Habilita "Salvar" só quando há alteração real; compara por dígitos (ignora máscara).
  const dataChanged =
    !!store &&
    (form.name.trim() !== (store.name ?? '') ||
      onlyDigits(form.cnpj) !== onlyDigits(store.cnpj) ||
      onlyDigits(form.phone) !== onlyDigits(store.phone));

  // RBAC (ADR-008): Configurações é área administrativa. A API já bloqueia as escritas;
  // aqui evitamos exibir a tela para quem não é Admin (acesso direto pela URL).
  if (meLoading) {
    return <div className="p-2 text-gray-500">Carregando…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-bold">Configurações da loja</h1>
        {/* Offline (tela online-only, ADR-012 (c)): o `GET /me` falha e o papel não pode ser
            confirmado — mostra o aviso de rede em vez de "acesso restrito", que soaria como
            problema de permissão. Online + não-Admin → o gate de RBAC de verdade (ADR-008). */}
        {online ? (
          <p className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm">
            Acesso restrito a administradores.
          </p>
        ) : (
          <OfflineNotice />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Configurações da loja</h1>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Logo</h2>
        <p className="mt-1 text-sm text-gray-500">
          Aparece no cabeçalho dos comprovantes e orçamentos. PNG, JPG ou WebP, até{' '}
          {Math.round(LOGO_MAX_BYTES / 1024 / 1024)} MB.
        </p>

        <div className="mt-5 flex items-center gap-5">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownLogo} alt="Logo da loja" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-gray-400">Sem logo</span>
            )}
          </div>

          <div className="flex-1">
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_ALLOWED_TYPES.join(',')}
              onChange={onPick}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={onUpload}
                disabled={busy || !file}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? 'Enviando…' : 'Salvar logo'}
              </button>
              {store?.logoUrl && (
                <button
                  onClick={onRemove}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-4 text-sm text-green-600">{success}</p>}
      </section>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Dados da loja</h2>
        <p className="mt-1 text-sm text-gray-500">
          Nome, CNPJ e telefone usados nos comprovantes e orçamentos.
        </p>

        <form onSubmit={onSaveData} className="mt-4 space-y-4">
          <div>
            <label htmlFor="store-name" className="block text-sm font-medium text-gray-700">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="store-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={120}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="store-cnpj" className="block text-sm font-medium text-gray-700">
                CNPJ
              </label>
              <input
                id="store-cnpj"
                type="text"
                inputMode="numeric"
                value={form.cnpj}
                // Digita só números; formata ao sair do campo (onBlur).
                onChange={(e) =>
                  setForm((f) => ({ ...f, cnpj: onlyDigits(e.target.value).slice(0, 14) }))
                }
                onBlur={() => setForm((f) => ({ ...f, cnpj: formatCnpj(f.cnpj) }))}
                maxLength={18}
                placeholder="Só números (ex.: 11222333000144)"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <div>
              <label htmlFor="store-phone" className="block text-sm font-medium text-gray-700">
                Telefone
              </label>
              <input
                id="store-phone"
                type="text"
                inputMode="numeric"
                value={form.phone}
                // Digita só números; formata ao sair do campo (onBlur).
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: onlyDigits(e.target.value).slice(0, 11) }))
                }
                onBlur={() => setForm((f) => ({ ...f, phone: formatPhoneBr(f.phone) }))}
                maxLength={20}
                placeholder="Só números (ex.: 11987654321)"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingData || !dataChanged}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingData ? 'Salvando…' : 'Salvar dados'}
            </button>
            {dataChanged && store && (
              <button
                type="button"
                onClick={() => {
                  fillForm(store);
                  setDataError(null);
                  setDataSuccess(null);
                }}
                disabled={savingData}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Descartar
              </button>
            )}
          </div>

          {dataError && <p className="text-sm text-red-600">{dataError}</p>}
          {dataSuccess && <p className="text-sm text-green-600">{dataSuccess}</p>}
        </form>
      </section>

      <UsersSection currentUserId={me?.id ?? null} />
    </div>
  );
}
