import { supabase } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

/** Monta o header Authorization com o access token da sessão atual. */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

async function handle<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiOk<T> | ApiErr | null;
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && 'error' in json && json.error) || `Erro ${res.status}`);
  }
  return json.data;
}

// --- Resiliência de leitura (só GET) -----------------------------------------------------------
// A stack no free tier tem cold start (Supabase pausa/esfria + Hyperdrive/Worker frios): a 1ª
// requisição depois de ociosa pode falhar no nível de REDE ("Failed to fetch") ou estourar o
// tempo, e a seguinte já funciona (conexão quente). Um retry curto com backoff mascara isso.
// Só re-tentamos GET (idempotente) e SÓ em falha de rede/timeout — erro HTTP (401/403/404/409/
// 500) é resposta válida do servidor e NÃO deve ser re-tentado.
const GET_RETRIES = 2; // tentativas totais = 1 + GET_RETRIES
const GET_BACKOFF_MS = [400, 1200];
const GET_TIMEOUT_MS = 12000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `true` quando o próprio `fetch` falhou (rede) ou a requisição foi abortada por timeout. */
function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError || // navegador lança TypeError em "Failed to fetch"
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** `fetch` com timeout (AbortController) para converter um hang em erro re-tentável. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= GET_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API_URL}${path}`, { headers });
      return await handle<T>(res);
    } catch (err) {
      // Erro HTTP (handle lançou) ou última tentativa: propaga sem re-tentar.
      if (!isNetworkError(err) || attempt === GET_RETRIES) throw err;
      lastErr = err;
      console.warn(`apiGet ${path}: falha de rede, re-tentando (${attempt + 1}/${GET_RETRIES})`);
      await sleep(GET_BACKOFF_MS[attempt] ?? 1200);
    }
  }
  throw lastErr;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return handle<T>(res);
}

/** Envia um arquivo como corpo cru da requisição (ex.: upload de logo, ADR-007). */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, ...(await authHeaders()) },
    body: file,
  });
  return handle<T>(res);
}
