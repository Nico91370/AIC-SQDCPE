import type { FastifyInstance } from 'fastify';
import { q } from '../db.ts';
import { PILLARS, actionState, addDays, daysBetween, monthBounds, todayIso } from '../domain.ts';

// Ex-onglet Pilotage : synthèse du mois par niveau, service, thème et origine.
export default async function pilotageRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string }; Querystring: { year?: string; month?: string } }>(
    '/api/sites/:siteId/pilotage',
    async (req) => {
      const siteId = Number(req.params.siteId);
      const today = todayIso();
      const year = Number(req.query.year ?? today.slice(0, 4));
      const month = Number(req.query.month ?? today.slice(5, 7));
      const { first, last } = monthBounds(year, month);

      const services = await q('SELECT id, name, level FROM services WHERE site_id=$1 ORDER BY level, ord, name', [siteId]);
      const levels = await q('SELECT level, instance FROM levels WHERE site_id=$1 ORDER BY level', [siteId]);
      const actions = (await q('SELECT * FROM actions WHERE site_id=$1', [siteId]))
        .map((a: any) => ({ ...a, state: actionState(a, today) }));
      const meas = await q(
        `SELECT m.aic_date, m.measure_date, m.status, m.comment, i.pillar, s.id AS service_id, s.level
           FROM measurements m JOIN indicators i ON i.id=m.indicator_id JOIN services s ON s.id=i.service_id
          WHERE m.site_id=$1 AND (m.aic_date BETWEEN $2 AND $3 OR m.measure_date BETWEEN $2 AND $3)`,
        [siteId, first, last]);

      const isOpen = (a: any) => a.status !== 'Soldée' && a.status !== 'Abandonnée';
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

      function stats(fa: (a: any) => boolean, fm: (m: any) => boolean) {
        const A = actions.filter(fa);
        const open = A.filter(isOpen);
        const closed = A.filter((a) => a.status === 'Soldée' && a.done_date && a.done_date >= first && a.done_date <= last);
        const M = meas.filter(fm);
        const inMonth = M.filter((m) => m.measure_date >= first && m.measure_date <= last);
        const ok = inMonth.filter((m) => m.status === 'OK').length;
        const nok = inMonth.filter((m) => m.status === 'NOK').length;
        return {
          open: open.length,
          late: open.filter((a) => a.state === 'En retard').length,
          dueSoon: open.filter((a) => a.due_date && a.due_date >= today && a.due_date <= addDays(today, 7)).length,
          raised: open.filter((a) => a.emitter_level && a.emitter_level !== a.level).length,
          avgAge: avg(open.map((a) => daysBetween(a.created_on, today))),
          gca: open.filter((a) => a.responsibility === 'GCA').length,
          client: open.filter((a) => a.responsibility === 'Client').length,
          closed: closed.length,
          avgDelay: avg(closed.map((a) => daysBetween(a.created_on, a.done_date))),
          onTime: closed.length ? closed.filter((a) => !a.due_date || a.done_date <= a.due_date).length / closed.length : null,
          problems: M.filter((m) => m.aic_date >= first && m.aic_date <= last && (m.comment ?? '').length > 0).length,
          ecarts: nok,
          conformity: ok + nok ? ok / (ok + nok) : null,
        };
      }

      const byLevel = levels.map((l: any) => ({
        level: l.level,
        instance: l.instance,
        total: stats((a) => a.level === l.level, (m) => m.level === l.level),
        services: services.filter((s: any) => s.level === l.level).map((s: any) => ({
          id: s.id, name: s.name,
          ...stats((a) => a.level === l.level && a.service_id === s.id, (m) => m.service_id === s.id),
        })),
      }));

      const byPillar = PILLARS.map((p) => {
        const s = stats((a) => a.pillar === p.code, (m) => m.pillar === p.code);
        const perLevel = [1, 2, 3].map((n) => actions.filter((a) => a.pillar === p.code && a.level === n && isOpen(a)).length);
        return { ...p, ...s, perLevel };
      });

      const origins = [...new Set(actions.filter(isOpen).map((a) => a.origin || 'Autre / non renseignée'))].map((o) => {
        const A = actions.filter((a) => isOpen(a) && (a.origin || 'Autre / non renseignée') === o);
        return { origin: o, perLevel: [1, 2, 3].map((n) => A.filter((a) => a.level === n).length), total: A.length };
      });

      return { year, month, first, last, today, site: stats(() => true, () => true), byLevel, byPillar, origins };
    },
  );
}
