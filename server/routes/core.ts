import type { FastifyInstance } from 'fastify';
import { q } from '../db.ts';
import { PILLARS, STATUSES, actionState, todayIso } from '../domain.ts';

export async function siteConfig(siteId: number) {
  const [levels, services, indicators, lists, people, holidays] = await Promise.all([
    q('SELECT level, instance FROM levels WHERE site_id=$1 ORDER BY level', [siteId]),
    q('SELECT id, name, level, ord, animator, deputy FROM services WHERE site_id=$1 ORDER BY level, ord, name', [siteId]),
    q(`SELECT id, service_id, pillar, label, unit, target, direction, active, on_chart, aggregation,
              axis_min, axis_max, axis_step, ord
         FROM indicators WHERE site_id=$1 ORDER BY service_id, pillar, ord, id`, [siteId]),
    q('SELECT id, kind, value, ord FROM list_values WHERE site_id=$1 ORDER BY kind, ord, value', [siteId]),
    q('SELECT id, name, function, service FROM people WHERE site_id=$1 ORDER BY name', [siteId]),
    q<{ day: string }>('SELECT day FROM holidays WHERE site_id=$1 ORDER BY day', [siteId]),
  ]);
  const byKind: Record<string, string[]> = {};
  for (const l of lists as any[]) (byKind[l.kind] ??= []).push(l.value);
  return {
    pillars: PILLARS,
    statuses: STATUSES,
    levels,
    services,
    indicators,
    lists: byKind,
    people,
    holidays: holidays.map((h) => h.day),
  };
}

export default async function coreRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req) => req.user);

  app.get('/api/sites', async () => q('SELECT id, name FROM sites ORDER BY name'));

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/config', async (req) =>
    siteConfig(Number(req.params.siteId)));

  // Accueil : une tuile par service avec actions ouvertes, en retard, soldées.
  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/home', async (req) => {
    const siteId = Number(req.params.siteId);
    const today = todayIso();
    const services = await q('SELECT id, name, level FROM services WHERE site_id=$1 ORDER BY level, ord, name', [siteId]);
    const acts = await q('SELECT service_id, level, status, due_date FROM actions WHERE site_id=$1', [siteId]);
    const tiles = services.map((s: any) => {
      const mine = acts.filter((a: any) => a.service_id === s.id && a.level === s.level);
      const open = mine.filter((a: any) => a.status !== 'Soldée' && a.status !== 'Abandonnée');
      return {
        ...s,
        open: open.length,
        late: open.filter((a: any) => actionState(a, today) === 'En retard').length,
        closed: mine.filter((a: any) => a.status === 'Soldée').length,
      };
    });
    const levels = await q('SELECT level, instance FROM levels WHERE site_id=$1 ORDER BY level', [siteId]);
    return { today, levels, tiles };
  });
}
