import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { verifySupabaseToken } from './supabaseToken';

/**
 * Casos de segurança da verificação do JWT do Supabase (correção de 2026-10-14: chaves locais +
 * 503 quando não dá para obter as chaves). Chaves ES256 geradas no teste; o "Supabase remoto" é um
 * servidor HTTP local, e o "Supabase fora do ar" é uma porta fechada.
 */

const DOWN_URL = 'http://127.0.0.1:9'; // porta fechada: qualquer busca remota falha na hora

let keyA: { privateKey: CryptoKey; jwk: JWK };
let keyB: { privateKey: CryptoKey; jwk: JWK };
let server: Server;
let remoteUrl: string;

async function makeKey(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey: privateKey as CryptoKey, jwk };
}

const jwks = (...keys: JWK[]) => JSON.stringify({ keys });

function sign(
  key: { privateKey: CryptoKey; jwk: JWK },
  supabaseUrl: string,
  o: { sub?: string; exp?: string; aud?: string } = {},
) {
  const jwt = new SignJWT(o.sub === undefined ? { sub: 'user-1' } : o.sub ? { sub: o.sub } : {})
    .setProtectedHeader({ alg: 'ES256', kid: key.jwk.kid })
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience(o.aud ?? 'authenticated')
    .setIssuedAt();
  return jwt.setExpirationTime(o.exp ?? '1h').sign(key.privateKey);
}

beforeAll(async () => {
  keyA = await makeKey('kid-a');
  keyB = await makeKey('kid-b');
  // "Supabase remoto" que publica só a chave B (a chave nova de uma rotação).
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(jwks(keyB.jwk));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  remoteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('verifySupabaseToken', () => {
  it('token válido confere com as chaves LOCAIS, sem ir à rede', async () => {
    const token = await sign(keyA, DOWN_URL);
    expect(await verifySupabaseToken(token, DOWN_URL, jwks(keyA.jwk))).toEqual({ ok: true, sub: 'user-1' });
  });

  it('assinatura adulterada, expirado, audiência errada e sem sub ⇒ inválido (401), não transitório', async () => {
    const good = await sign(keyA, DOWN_URL);
    const [h, p, sig] = good.split('.');
    const tampered = `${h}.${p}.${sig!.slice(0, -4)}AAAA`;
    const expired = await sign(keyA, DOWN_URL, { exp: '-1m' });
    const wrongAud = await sign(keyA, DOWN_URL, { aud: 'anon' });
    const noSub = await sign(keyA, DOWN_URL, { sub: '' });
    for (const t of [tampered, expired, wrongAud, noSub, 'nao-e-um-jwt']) {
      expect(await verifySupabaseToken(t, DOWN_URL, jwks(keyA.jwk))).toEqual({ ok: false, transient: false });
    }
  });

  it('token de outro emissor não passa', async () => {
    const token = await sign(keyA, 'https://outro.supabase.co');
    expect(await verifySupabaseToken(token, DOWN_URL, jwks(keyA.jwk))).toEqual({ ok: false, transient: false });
  });

  it('chave nova (rotação) cai no JWKS remoto e confere', async () => {
    const token = await sign(keyB, remoteUrl);
    expect(await verifySupabaseToken(token, remoteUrl, jwks(keyA.jwk))).toEqual({ ok: true, sub: 'user-1' });
  });

  it('chave fora da lista local e Supabase fora do ar ⇒ transitório (503), nunca aceita', async () => {
    const token = await sign(keyB, DOWN_URL);
    expect(await verifySupabaseToken(token, DOWN_URL, jwks(keyA.jwk))).toEqual({ ok: false, transient: true });
  });

  it('sem chaves locais (ou var malformada) usa só o remoto; fora do ar ⇒ transitório', async () => {
    const token = await sign(keyA, DOWN_URL);
    expect(await verifySupabaseToken(token, DOWN_URL, undefined)).toEqual({ ok: false, transient: true });
    expect(await verifySupabaseToken(token, DOWN_URL, '{nao-e-json')).toEqual({ ok: false, transient: true });
  });

  it('token assinado por chave que o remoto não publica ⇒ inválido, não transitório', async () => {
    const token = await sign(keyA, remoteUrl); // remoto só tem a B; local vazio
    expect(await verifySupabaseToken(token, remoteUrl, jwks())).toEqual({ ok: false, transient: false });
  });
});
