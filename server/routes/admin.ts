import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.ts';
import { clearUserCache, requireRole } from '../auth.ts';

// Administration des référentiels (ex-onglets Indicateurs, Équipe, Paramètres).
export default async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  const IND_FIELDS = ['service_id', 'pillar', 'label', 'unit', 'target', 'direction', 'active', 'on_chart',
    'aggregation', 'axis_min', 'axis_max', 'axis_step', 'ord'] as const;

  app.post<{ Params: { siteId: string }; Body: any }>('/api/sites/:siteId/indicators', admin, async (req) => {
    const b: any = req.body ?? {};
    const vals = IND_FIELDS.map((k) => (b[k] === '' ? null : b[k] ?? null));
    vals[IND_FIELDS.indexOf('active')] ??= true;
    vals[IND_FIELDS.indexOf('on_chart')] ??= false;
    vals[IND_FIELDS.indexOf('aggregation')] ??= 'Somme';
    vals[IND_FIELDS.indexOf('ord')] ??= 0;
    return one(
      `INSERT INTO indicators(site_id, ${IND_FIELDS.join(',')}) VALUES ($1, ${IND_FIELDS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
      [Number(req.params.siteId), ...vals]);
  });

  app.patch<{ Params: { siteId: string; id: string }; Body: any }>('/api/sites/:siteId/indicators/:id', admin, async (req) => {
    const b: any = req.body ?? {};
    const keys = IND_FIELDS.filter((k) => k in b);
    if (!keys.length) return one('SELECT * FROM indicators WHERE id=$1', [Number(req.params.id)]);
    return one(
      `UPDATE indicators SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE site_id=$1 AND id=$2 RETURNING *`,
      [Number(req.params.siteId), Number(req.params.id), ...keys.map((k) => (b[k] === '' ? null : b[k]))]);
  });

  app.delete<{ Params: { siteId: string; id: string } }>('/api/sites/:siteId/indicators/:id', admin, async (req, reply) => {
    const used = await one('SELECT count(*)::int AS n FROM measurements WHERE indicator_id=$1', [Number(req.params.id)]);
    if (used.n > 0) return reply.code(409).send({ error: `Cet indicateur a ${used.n} mesures : désactivez-le plutôt que de le supprimer.` });
    await q('DELETE FROM indicators WHERE site_id=$1 AND id=$2', [Number(req.params.siteId), Number(req.params.id)]);
    return { ok: true };
  });

  app.patch<{ Params: { siteId: string; id: string }; Body: any }>('/api/sites/:siteId/services/:id', admin, async (req) => {
    const b: any = req.body ?? {};
    const keys = (['name', 'animator', 'deputy', 'ord'] as const).filter((k) => k in b);
    if (!keys.length) return one('SELECT * FROM services WHERE id=$1', [Number(req.params.id)]);
    return one(
      `UPDATE services SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE site_id=$1 AND id=$2 RETURNING *`,
      [Number(req.params.siteId), Number(req.params.id), ...keys.map((k) => b[k])]);
  });

  app.post<{ Params: { siteId: string }; Body: { name: string; level: number } }>('/api/sites/:siteId/services', admin, async (req) =>
    one('INSERT INTO services(site_id, name, level, ord) VALUES ($1,$2,$3,99) RETURNING *',
      [Number(req.params.siteId), req.body.name, req.body.level]));

  // Listes paramétrables : remplace toute la liste d'un type.
  app.put<{ Params: { siteId: string; kind: string }; Body: { values: string[] } }>('/api/sites/:siteId/lists/:kind', admin, async (req) => {
    const siteId = Number(req.params.siteId);
    const values = (req.body?.values ?? []).map((v) => v.trim()).filter(Boolean);
    await q('DELETE FROM list_values WHERE site_id=$1 AND kind=$2', [siteId, req.params.kind]);
    for (const [i, v] of [...new Set(values)].entries()) {
      await q('INSERT INTO list_values(site_id, kind, value, ord) VALUES ($1,$2,$3,$4)', [siteId, req.params.kind, v, i]);
    }
    return { ok: true };
  });

  app.put<{ Params: { siteId: string }; Body: { days: string[] } }>('/api/sites/:siteId/holidays', admin, async (req) => {
    const siteId = Number(req.params.siteId);
    await q('DELETE FROM holidays WHERE site_id=$1', [siteId]);
    for (const d of new Set(req.body?.days ?? [])) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) await q('INSERT INTO holidays(site_id, day) VALUES ($1,$2)', [siteId, d]);
    }
    return { ok: true };
  });

  app.post<{ Body: { name: string } }>('/api/sites', admin, async (req) => {
    const site = await one('INSERT INTO sites(name) VALUES ($1) RETURNING *', [req.body.name]);
    await q(`INSERT INTO levels(site_id, level, instance) VALUES ($1,1,'AIC Équipe'),($1,2,'AIC Global Opération'),($1,3,'AIC Management Site')`, [site.id]);
    return site;
  });

  app.get('/api/users', admin, async () => q('SELECT email, name, role, last_login FROM users ORDER BY name'));
  app.patch<{ Params: { email: string }; Body: { role: string } }>('/api/users/:email', admin, async (req, reply) => {
    if (!['admin', 'animateur', 'lecteur'].includes(req.body?.role)) return reply.code(400).send({ error: 'Rôle inconnu' });
    clearUserCache(req.params.email);
    return one('UPDATE users SET role=$1 WHERE email=$2 RETURNING email, name, role', [req.body.role, req.params.email]);
  });
}
