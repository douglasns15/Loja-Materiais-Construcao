'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { modulesForSegments, suggestedCategoriesForSegments } from '@nexoloja/core';
import {
  STORE_SEGMENT_LABELS,
  TENANT_MODULE_KEYS,
  TENANT_MODULE_LABELS,
  createTenantSchema,
  formatCnpj,
  storeSegmentSchema,
  type StoreSegment,
  type TenantModuleKey,
  SCALE_LABEL_VALUE_LABELS,
  type ScaleLabelLayoutInput,
} from '@nexoloja/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { saveSupportSession } from '@/lib/support';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  cnpj: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  /** Módulo de vendas offline ligado (ADR-011, recurso de plano pago). */
  offlineSales: boolean;
  /** Ramos da loja (ADR-039). */
  segments: StoreSegment[];
  /** Chaves dos módulos ATIVOS (ADR-039 + offline). */
  modules: string[];
  /** Layout da etiqueta de balança (ADR-040 §3) — padrão quando nunca foi configurado. */
  scaleLabel?: ScaleLabelLayoutInput;
  /**
   * Momento da última operação real da loja (venda/estoque/caixa) — derivado no servidor.
   * `null` = a loja ainda não teve nenhuma atividade. Não confundir com "online/offline"
   * (que é do dispositivo, não do tenant): isto responde "está sendo usada?".
   */
  lastActivityAt: string | null;
};

type CreatedTenant = {
  id: string;
  name: string;
  slug: string;
  admin: { email: string };
};

const DATE = (v: string) => new Date(v).toLocaleDateString('pt-BR');

/** Janela em que consideramos a loja "ativa agora" (última operação recente). */
const ACTIVE_NOW_MS = 15 * 60 * 1000;

/**
 * Rótulo relativo em PT-BR de "quanto tempo atrás" (última atividade da loja). Presentacional —
 * `nowMs` é injetável para determinismo. Escala: agora → min → h → dias; acima disso cai na data.
 */
function timeAgoPtBr(iso: string, nowMs: number = Date.now()): string {
  const diff = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60_000) return 'agora mesmo';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  return `em ${new Date(iso).toLocaleDateString('pt-BR')}`;
}

export default function PlataformaPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Interruptor de módulo em andamento: `${tenantId}:${moduleKey}`.
  const [togglingModule, setTogglingModule] = useState<string | null>(null);
  const [supportingId, setSupportingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    adminEmail: '',
    adminName: '',
    cnpj: '',
    slug: '',
  });
  // Ramo da loja nova (ADR-039): começa vazio de propósito — o implantador escolhe conscientemente.
  const [segments, setSegments] = useState<StoreSegment[]>([]);
  // Categorias sugeridas DESMARCADAS pelo implantador (as demais são criadas com a loja). Guardar as
  // desmarcadas (e não as marcadas) faz as sugestões de um ramo recém-escolhido já nascerem marcadas.
  const [uncheckedCats, setUncheckedCats] = useState<string[]>([]);
  const presetModules = modulesForSegments(segments);
  const suggestedCats = suggestedCategoriesForSegments(segments);

  function toggleSegment(seg: StoreSegment) {
    setSegments((cur) => (cur.includes(seg) ? cur.filter((x) => x !== seg) : [...cur, seg]));
  }

  async function load() {
    try {
      setTenants(await apiGet<Tenant[]>('/platform/tenants'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Valida no cliente (feedback imediato); a fonte de verdade é a API.
    if (segments.length === 0) {
      setError('Escolha ao menos um ramo para a loja.');
      return;
    }
    const parsed = createTenantSchema.safeParse({
      segments,
      seedCategories: suggestedCats.filter((cat) => !uncheckedCats.includes(cat)),
      name: form.name,
      adminEmail: form.adminEmail,
      adminName: form.adminName || undefined,
      cnpj: form.cnpj || undefined,
      slug: form.slug || undefined,
      redirectTo:
        typeof window !== 'undefined' ? `${window.location.origin}/definir-senha` : undefined,
    });
    if (!parsed.success) {
      setError('Confira os campos: nome da loja e e-mail do admin são obrigatórios.');
      return;
    }

    setSaving(true);
    try {
      const created = await apiPost<CreatedTenant>('/platform/tenants', parsed.data);
      setSuccess(
        `Loja "${created.name}" criada. Convite enviado para ${created.admin.email} — o admin define a senha pelo link do e-mail.`,
      );
      setForm({ name: '', adminEmail: '', adminName: '', cnpj: '', slug: '' });
      setSegments([]);
      setUncheckedCats([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Entra no contexto de uma loja em MODO SUPORTE (ADR-009, Fatia E — somente-leitura). Pede à
   * API um token de sessão de suporte, guarda no `sessionStorage` e abre o painel de suporte.
   */
  async function enterSupport(t: Tenant) {
    setError(null);
    setSuccess(null);
    setSupportingId(t.id);
    try {
      const data = await apiPost<{ token: string; expiresAt: string; tenant: { name: string } }>(
        `/platform/tenants/${t.id}/support`,
        {},
      );
      saveSupportSession(t.id, {
        token: data.token,
        expiresAt: data.expiresAt,
        tenantName: data.tenant.name,
      });
      router.push(`/plataforma/suporte/${t.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSupportingId(null);
    }
  }

  async function toggleActive(t: Tenant) {
    setError(null);
    setSuccess(null);
    setTogglingId(t.id);
    try {
      await apiPatch(`/platform/tenants/${t.id}`, { isActive: !t.isActive });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  /**
   * Liga/desliga um MÓDULO da loja (upsert em `TenantModule` pela API; ausência/inativa = OFF).
   * `OFFLINE_SALES` (ADR-011 §9) é a fronteira comercial + botão de pânico da venda offline;
   * `CONSTRUCTION_UNITS`/`SCALE_LABEL` (ADR-039) só mostram/escondem recurso na tela da loja —
   * desligar nunca apaga dado nem quebra venda.
   */
  async function toggleModule(t: Tenant, moduleKey: TenantModuleKey) {
    setError(null);
    setSuccess(null);
    setTogglingModule(`${t.id}:${moduleKey}`);
    try {
      await apiPatch(`/platform/tenants/${t.id}/modules`, {
        moduleKey,
        isActive: !t.modules.includes(moduleKey),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingModule(null);
    }
  }

  /**
   * Layout da etiqueta de balança (ADR-040 §3): nº de dígitos do PLU e valor embutido (preço ou peso),
   * como a balança da loja foi configurada. Grava em `TenantModule.config` do SCALE_LABEL.
   */
  async function saveScaleLayout(t: Tenant, next: ScaleLabelLayoutInput) {
    setError(null);
    setSuccess(null);
    setTogglingModule(`${t.id}:SCALE_LABEL`);
    try {
      await apiPatch(`/platform/tenants/${t.id}/modules`, {
        moduleKey: 'SCALE_LABEL',
        isActive: true,
        config: next,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingModule(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Lojas</h1>
      <p className="mb-6 text-sm text-gray-600">
        Gestão da plataforma — criar lojas e controlar quais estão ativas.
      </p>

      {/* Criar loja + convidar 1º Admin */}
      <form onSubmit={onCreate} className="mb-6 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-semibold">Nova loja</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            placeholder="Nome da loja *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="E-mail do admin *"
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="Nome do admin (opcional)"
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="CNPJ (opcional)"
            value={form.cnpj}
            onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="Identificador/slug (opcional — gerado do nome)"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
          />
        </div>

        {/* Ramo da loja (ADR-039): multisseleção em chips. É preset — liga módulos e sugere
            categorias; os módulos seguem ajustáveis depois, na lista abaixo. */}
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium text-gray-700">
            Ramo da loja * <span className="font-normal text-gray-500">(pode marcar mais de um)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {storeSegmentSchema.options.map((seg) => {
              const on = segments.includes(seg);
              return (
                <button
                  key={seg}
                  type="button"
                  onClick={() => toggleSegment(seg)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    on
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-400'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {STORE_SEGMENT_LABELS[seg]}
                </button>
              );
            })}
          </div>

          {segments.length > 0 && (
            <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
              <p className="text-gray-700">
                <span className="font-medium">Vai ligar:</span>{' '}
                {TENANT_MODULE_KEYS.filter((k) => k !== 'OFFLINE_SALES').map((k, idx) => (
                  <span key={k} className={presetModules.some((m) => m === k) ? 'text-emerald-700' : 'text-gray-400'}>
                    {idx > 0 ? ' · ' : ''}
                    {TENANT_MODULE_LABELS[k].label} {presetModules.some((m) => m === k) ? '✓' : '✗'}
                  </span>
                ))}
              </p>
              {suggestedCats.length > 0 && (
                <div>
                  <p className="mb-1 font-medium text-gray-700">Categorias iniciais (desmarque as que não quiser):</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {suggestedCats.map((cat) => (
                      <label key={cat} className="flex items-center gap-1.5 text-gray-700">
                        <input
                          type="checkbox"
                          checked={!uncheckedCats.includes(cat)}
                          onChange={(e) =>
                            setUncheckedCats((cur) =>
                              e.target.checked ? cur.filter((x) => x !== cat) : [...cur, cat],
                            )
                          }
                        />
                        {cat}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </fieldset>
        <button
          type="submit"
          disabled={saving}
          className="mt-3 w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:w-auto sm:px-6"
        >
          {saving ? 'Criando…' : 'Criar loja e convidar admin'}
        </button>
        <p className="mt-2 text-xs text-gray-500">
          O admin recebe um e-mail para definir a senha e entra como dono (OWNER) da loja.
        </p>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {success && (
        <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">
          {success}
        </p>
      )}

      {/* Lista de lojas */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-blue-200 text-left text-blue-900">
            <tr>
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">CNPJ</th>
              <th className="px-4 py-2 text-right">Usuários</th>
              <th className="px-4 py-2">Criada</th>
              <th className="px-4 py-2">Última atividade</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Ramo e módulos</th>
              <th className="px-4 py-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  Nenhuma loja cadastrada.
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.slug}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{t.cnpj ? formatCnpj(t.cnpj) : '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{t.userCount}</td>
                  <td className="px-4 py-2 text-gray-600">{DATE(t.createdAt)}</td>
                  <td className="px-4 py-2">
                    {t.lastActivityAt === null ? (
                      <span className="text-gray-500">— sem atividade</span>
                    ) : Date.now() - new Date(t.lastActivityAt).getTime() < ACTIVE_NOW_MS ? (
                      <span className="inline-flex items-center gap-1.5 text-green-700">
                        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
                        ativa agora
                      </span>
                    ) : (
                      <span className="text-gray-600" title={new Date(t.lastActivityAt).toLocaleString('pt-BR')}>
                        {timeAgoPtBr(t.lastActivityAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {t.isActive ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {/* Ramos (ADR-039) + interruptores de módulo (ramo e venda offline paga). */}
                    <div className="mb-1.5 text-xs text-gray-600">
                      {t.segments.length > 0
                        ? t.segments.map((seg) => STORE_SEGMENT_LABELS[seg]).join(' · ')
                        : '— ramo não informado'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TENANT_MODULE_KEYS.map((k) => {
                        const on = t.modules.includes(k);
                        const busy = togglingModule === `${t.id}:${k}`;
                        return (
                          <button
                            key={k}
                            onClick={() => toggleModule(t, k)}
                            disabled={busy}
                            aria-pressed={on}
                            title={`${TENANT_MODULE_LABELS[k].hint} — clique para ${on ? 'desligar' : 'ligar'}`}
                            className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                              on
                                ? 'border-indigo-300 bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                                : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            {busy ? '…' : `${TENANT_MODULE_LABELS[k].label} ${on ? 'ON' : 'OFF'}`}
                          </button>
                        );
                      })}
                    </div>
                    {/* Layout da etiqueta (ADR-040 §3): só com o módulo ligado. Confirme na balança da loja. */}
                    {t.modules.includes('SCALE_LABEL') && t.scaleLabel && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                        <span>Etiqueta:</span>
                        <select
                          value={t.scaleLabel.pluDigits}
                          onChange={(e) =>
                            saveScaleLayout(t, { ...t.scaleLabel!, pluDigits: Number(e.target.value) as 4 | 5 })
                          }
                          disabled={togglingModule === `${t.id}:SCALE_LABEL`}
                          aria-label="Dígitos do código na balança (PLU)"
                          className="rounded border border-gray-300 bg-white px-1 py-0.5"
                        >
                          <option value={4}>PLU 4 dígitos</option>
                          <option value={5}>PLU 5 dígitos</option>
                        </select>
                        <select
                          value={t.scaleLabel.value}
                          onChange={(e) =>
                            saveScaleLayout(t, {
                              ...t.scaleLabel!,
                              value: e.target.value as ScaleLabelLayoutInput['value'],
                            })
                          }
                          disabled={togglingModule === `${t.id}:SCALE_LABEL`}
                          aria-label="Valor embutido na etiqueta"
                          className="rounded border border-gray-300 bg-white px-1 py-0.5"
                        >
                          {(['PRICE', 'WEIGHT'] as const).map((v) => (
                            <option key={v} value={v}>
                              {SCALE_LABEL_VALUE_LABELS[v]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => enterSupport(t)}
                        disabled={supportingId === t.id}
                        className="rounded-lg border border-blue-600 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        title="Entrar na loja em modo suporte (somente leitura)"
                      >
                        {supportingId === t.id ? '…' : 'Entrar (suporte)'}
                      </button>
                      <button
                        onClick={() => toggleActive(t)}
                        disabled={togglingId === t.id}
                        className={`rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                          t.isActive
                            ? 'border-gray-300 text-gray-700 hover:bg-gray-100'
                            : 'border-green-600 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {togglingId === t.id ? '…' : t.isActive ? 'Inativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
