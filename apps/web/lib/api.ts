import { supabase } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

/**
 * Access token da sessão atual; se ausente mas houver `refresh_token`, força UMA renovação.
 * Cobre a corrida "PWA ociosa + cold start": o access token (JWT ~1h) expira enquanto a aba fica
 * parada e a tela dispara o fetch ANTES de o supabase-js renovar (ou a renovação bate num Supabase
 * frio e falha). Sem isso, `getSession()` volta sem token e a requisição sairia SEM `Authorization`,
 * resultando no 401 "Token de autenticação ausente." (que só sumia com Refresh forçado da página).
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  // Sem token em mãos: tenta trocar o refresh_token por um access token novo (não deve lançar —
  // devolve o erro no objeto —, mas protegemos mesmo assim para nunca derrubar a chamada).
  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Monta o header Authorization com o access token da sessão atual (renovando se preciso). */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
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

// --- Resiliência de rede -----------------------------------------------------------------------
// A stack no free tier tem cold start (Supabase pausa/esfria + Hyperdrive/Worker frios): a 1ª
// requisição depois de ociosa pode falhar no nível de REDE ("Failed to fetch") ou estourar o
// tempo, e a seguinte já funciona (conexão quente). Um retry curto com backoff mascara isso.
// Só re-tentamos métodos IDEMPOTENTES (GET/PATCH/DELETE) e SÓ em falha de rede/timeout — erro
// HTTP (401/403/404/409/500) é resposta válida do servidor e NÃO deve ser re-tentado. O POST
// (criar venda/produto) fica FORA do retry de propósito: não é idempotente e re-tentar poderia
// duplicar o recurso.
const RETRIES = 2; // tentativas totais = 1 + RETRIES
const BACKOFF_MS = [400, 1200];
const TIMEOUT_MS = 12000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mensagem amigável para o usuário quando a falha é de REDE (o `fetch` nem completou). Substitui
 * o "Failed to fetch" cru do navegador, que assusta e não distingue "sem internet" de "servidor
 * engasgou". Erros de negócio/HTTP (ex.: "Estoque insuficiente", "Erro 409") passam intactos.
 */
const NETWORK_ERROR_MSG =
  'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente em instantes.';

/** `true` quando o próprio `fetch` falhou (rede) ou a requisição foi abortada por timeout. */
function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError || // navegador lança TypeError em "Failed to fetch"
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** Converte falha de rede/timeout na mensagem amigável; qualquer outro erro passa sem alteração. */
function toFriendly(err: unknown): Error {
  if (isNetworkError(err)) return new Error(NETWORK_ERROR_MSG);
  return err instanceof Error ? err : new Error(String(err));
}

/** `fetch` com timeout (AbortController) para converter um hang em erro re-tentável. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envia uma requisição IDEMPOTENTE (GET/PATCH/DELETE) com timeout, retry curto em falha de rede e
 * renovação de token no 401. Centraliza a resiliência que antes era só do GET: como repetir esses
 * métodos produz o mesmo efeito, o retry é seguro. O POST tem função própria (`apiPost`) e fica de
 * fora daqui. DELETE re-tentado após um sucesso perdido na volta pode ver um 404 (recurso já foi):
 * é uma resposta válida do servidor, então o `handle` propaga — trade-off aceito (evento raríssimo).
 */
async function sendIdempotent<T>(
  method: 'GET' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let lastErr: unknown;
  let authRetried = false; // só uma tentativa de renovar o token por chamada
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // Recalcula o header a cada volta: se renovamos o token no 401 abaixo, a próxima já o usa.
      const headers: Record<string, string> = { ...(await authHeaders()) };
      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetchWithTimeout(`${API_URL}${path}`, init);
      // 401 numa corrida de renovação (token expirado/ausente por PWA ociosa + cold start): força
      // um refresh e re-tenta UMA vez, sem consumir o orçamento de retry de rede. Se o refresh não
      // trouxer token, deixa o `handle` propagar o erro normalmente (sessão realmente perdida).
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        let token: string | null = null;
        try {
          const { data } = await supabase.auth.refreshSession();
          token = data.session?.access_token ?? null;
        } catch {
          /* refresh falhou → cai no handle abaixo e propaga o 401 */
        }
        if (token) {
          attempt--; // esta volta não conta como tentativa de rede
          continue;
        }
      }
      return await handle<T>(res);
    } catch (err) {
      // Erro HTTP (handle lançou) ou última tentativa: propaga com mensagem amigável se for rede.
      if (!isNetworkError(err) || attempt === RETRIES) throw toFriendly(err);
      lastErr = err;
      console.warn(`api ${method} ${path}: falha de rede, re-tentando (${attempt + 1}/${RETRIES})`);
      await sleep(BACKOFF_MS[attempt] ?? 1200);
    }
  }
  throw toFriendly(lastErr);
}

export async function apiGet<T>(path: string): Promise<T> {
  return sendIdempotent<T>('GET', path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  // POST NÃO é re-tentado (não idempotente — poderia duplicar a venda/produto), mas ainda
  // convertemos a falha de rede na mensagem amigável para não vazar "Failed to fetch" cru.
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    return await handle<T>(res);
  } catch (err) {
    throw toFriendly(err);
  }
}

/**
 * POST para o **worker de sincronização** (ADR-011): devolve o **status HTTP bruto** sem lançar em
 * erro HTTP, para o worker classificar 2xx/409/5xx/4xx (`classifyHttpOutcome` do core). Lança
 * **apenas** em falha de REDE (offline/timeout) — que o worker trata como transitória. Reaproveita
 * o `authHeaders` (Bearer do Supabase); a autoria/tenant são resolvidos no servidor pelo JWT.
 */
export async function apiPostForSync(path: string, body: unknown): Promise<{ status: number }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return sendIdempotent<T>('PATCH', path, body);
}

export async function apiDelete<T>(path: string): Promise<T> {
  return sendIdempotent<T>('DELETE', path);
}

/**
 * Igual a `apiGet`, mas com um Bearer token EXPLÍCITO em vez do access token do Supabase.
 * Usado pela SESSÃO DE SUPORTE (ADR-009, Fatia E): o Super Usuário lê a loja-alvo com o token
 * de suporte emitido pela API, não com a própria sessão. Sem retry (chamadas pontuais do painel).
 */
export async function apiGetWithToken<T>(path: string, token: string): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await handle<T>(res);
  } catch (err) {
    throw toFriendly(err);
  }
}

/** POST com Bearer token explícito (ex.: encerrar a sessão de suporte). Corpo opcional. */
export async function apiPostWithToken<T>(path: string, token: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await handle<T>(res);
  } catch (err) {
    throw toFriendly(err);
  }
}

/** Envia um arquivo como corpo cru da requisição (ex.: upload de logo, ADR-007). */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, ...(await authHeaders()) },
      body: file,
    });
    return await handle<T>(res);
  } catch (err) {
    throw toFriendly(err);
  }
}
