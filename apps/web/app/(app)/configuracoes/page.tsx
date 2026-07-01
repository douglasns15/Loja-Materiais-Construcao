'use client';

import { useEffect, useRef, useState } from 'react';
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES, validateLogo } from '@nexoloja/shared';
import { apiDelete, apiGet, apiUpload } from '@/lib/api';

type Store = {
  name: string;
  logoUrl: string | null;
  cnpj: string | null;
  phone: string | null;
};

export default function ConfiguracoesPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Preview local (objectURL) enquanto o arquivo escolhido ainda não foi enviado.
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setStore(await apiGet<Store>('/tenant'));
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

  const shownLogo = preview ?? store?.logoUrl ?? null;

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
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Nome</dt>
            <dd className="font-medium">{store?.name ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">CNPJ</dt>
            <dd className="font-medium">{store?.cnpj ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Telefone</dt>
            <dd className="font-medium">{store?.phone ?? '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-gray-400">
          Edição de nome/CNPJ/telefone entra numa próxima etapa desta tela.
        </p>
      </section>
    </div>
  );
}
