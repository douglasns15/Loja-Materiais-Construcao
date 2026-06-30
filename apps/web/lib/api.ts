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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() });
  return handle<T>(res);
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
