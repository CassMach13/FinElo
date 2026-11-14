/** JWT sintético (assinatura falsa): só para testar a leitura local de `sub` / `session_id`. */
export const fakeJwt = (payload: Record<string, unknown>) => {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
};

export const userJwt = (sub: string, sessionId = `sess-${sub}`) =>
  fakeJwt({ sub, session_id: sessionId, role: 'authenticated', aud: 'authenticated' });
