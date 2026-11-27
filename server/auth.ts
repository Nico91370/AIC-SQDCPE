import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { one, q } from './db.ts';

// Deux modes :
//  - AUTH_MODE=entra : connexion Microsoft 365 (Entra ID). Le navigateur obtient un
//    jeton d'identité via MSAL ; le serveur le vérifie avec les clés publiques du tenant.
//  - AUTH_MODE=dev (par défaut) : pour tester en local, l'utilisateur saisit son nom.

export type Role = 'admin' | 'animateur' | 'lecteur';
export interface User { email: string; name: string; role: Role }

declare module 'fastify' {
  interface FastifyRequest { user?: User }
}

export const authMode = (process.env.AUTH_MODE ?? 'dev') as 'dev' | 'entra';
const tenant = process.env.ENTRA_TENANT_ID ?? '';
const clientId = process.env.ENTRA_CLIENT_ID ?? '';
const adminEmails = (process.env.ADMIN_EMAILS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const defaultRole = (process.env.DEFAULT_ROLE ?? 'animateur') as Role;
// Mode test : code d'accès partagé, demandé à l'entrée (recommandé dès que le site est en ligne).
const accessCode = (process.env.ACCESS_CODE ?? '').trim();

if (authMode === 'entra' && (!tenant || !clientId)) {
  throw new Error('AUTH_MODE=entra exige ENTRA_TENANT_ID et ENTRA_CLIENT_ID');
}

const jwks = authMode === 'entra'
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`))
  : null;

export function publicAuthConfig() {
  return authMode === 'entra'
    ? { mode: 'entra', tenantId: tenant, clientId }
    : { mode: 'dev', codeRequired: accessCode.length > 0 };
}

async function identify(req: FastifyRequest): Promise<{ email: string; name: string } | null> {
  const h = req.headers.authorization ?? '';
  if (authMode === 'entra') {
    if (!h.startsWith('Bearer ')) return null;
    const { payload } = await jwtVerify(h.slice(7), jwks!, {
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      audience: clientId,
    });
    const email = String(payload.preferred_username ?? payload.email ?? payload.oid ?? '').toLowerCase();
    if (!email) return null;
    return { email, name: String(payload.name ?? email) };
  }
  if (!h.startsWith('Dev ')) return null;
  let name = decodeURIComponent(h.slice(4)).trim();
  if (accessCode) {
    const sep = name.indexOf(':');
    if (sep < 0 || name.slice(0, sep) !== accessCode) return null;
    name = name.slice(sep + 1).trim();
  }
  if (!name) return null;
  return { email: name.toLowerCase().replace(/\s+/g, '.') + '@local', name };
}

const seen = new Map<string, { user: User; at: number }>();

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  let id: { email: string; name: string } | null = null;
  try {
    id = await identify(req);
  } catch {
    id = null;
  }
  if (!id) return reply.code(401).send({ error: 'Connexion requise' });
  const cached = seen.get(id.email);
  if (cached && Date.now() - cached.at < 60_000) {
    req.user = cached.user;
    return;
  }
  const count = Number((await one<{ n: number }>('SELECT count(*)::int AS n FROM users'))?.n ?? 0);
  const initialRole: Role = count === 0 || adminEmails.includes(id.email) ? 'admin' : defaultRole;
  const row = (await q<User>(
    `INSERT INTO users(email, name, role, last_login) VALUES ($1,$2,$3,now())
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, last_login = now(),
       role = CASE WHEN $4 THEN 'admin' ELSE users.role END
     RETURNING email, name, role`,
    [id.email, id.name, initialRole, adminEmails.includes(id.email)],
  ))[0];
  seen.set(id.email, { user: row, at: Date.now() });
  req.user = row;
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Droits insuffisants' });
    }
  };
}

export function clearUserCache(email?: string) {
  if (email) seen.delete(email); else seen.clear();
}
