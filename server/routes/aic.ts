import type { FastifyInstance } from 'fastify';
import { q, tx } from '../db.ts';
import { requireRole } from '../auth.ts';
import {
  PILLARS, actionRef, actionState, addDays, dayState, isWeekend, measureDate, measureStatus, monthBounds, todayIso,
  type Direction,
} from '../domain.ts';

interface Scope { level: number; serviceIds: number[]; services: any[] }

/** Périmètre de l'écran d'AIC : un niveau, un service ou « tous » (N1). */
export async function resolveScope(siteId: number, level: number, service: string | undefined): Promise<Scope> {
  const services = await q('SELECT id, name, level, animator, deputy FROM services WHERE site_id=$1 AND level=$2 ORDER BY ord, name', [siteId, level]);
  let chosen = services;
  if (service && service !== 'all') chosen = services.filter((s: any) => String(s.id) === String(service));
  if (chosen.length === 0) chosen = services;
  return { level, serviceIds: chosen.map((s: any) => s.id), services: chosen };
}

export default async function aicRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string }; Querystring: { level?: string; service?: string; date?: string } }>(
    '/api/sites/:siteId/aic',
    async (req) => {
      const siteId = Number(req.params.siteId);
      const level = Math.min(3, Math.max(1, Number(req.query.level ?? 1)));
      const date = req.query.date ?? todayIso();
      const today = todayIso();
      const scope = await resolveScope(siteId, level, req.query.service);
      const ids = scope.serviceIds;
      const y = Number(date.slice(0, 4));
      const m = Number(date.slice(5, 7));
      const { first, last, days } = monthBounds(y, m);

      const indicators = await q(
        `SELECT i.*, s.name AS service_name, s.ord AS service_ord FROM indicators i JOIN services s ON s.id=i.service_id
          WHERE i.site_id=$1 AND i.service_id = ANY($2) ORDER BY s.ord, i.pillar, i.ord, i.id`, [siteId, ids]);
      const indIds = indicators.map((i: any) => i.id);
      const monthMeas = await q(
        `SELECT id, indicator_id, aic_date, measure_date, value, target, status, comment
           FROM measurements WHERE indicator_id = ANY($1) AND aic_date BETWEEN $2 AND $3`, [indIds, first, last]);
      const holidays = new Set((await q<{ day: string }>('SELECT day FROM holidays WHERE site_id=$1', [siteId])).map((h) => h.day));
      const indById = new Map(indicators.map((i: any) => [i.id, i]));

      // Saisie du jour
      const todays = new Map(monthMeas.filter((x: any) => x.aic_date === date).map((x: any) => [x.indicator_id, x]));

      const pillars = PILLARS.map((p) => {
        const inds = indicators.filter((i: any) => i.pillar === p.code);
        const active = inds.filter((i: any) => i.active);
        // Calendrier du mois : état de chaque jour pour ce pilier
        const calendar = Array.from({ length: days }, (_, k) => {
          const d = addDays(first, k);
          const sts = monthMeas.filter((x: any) => x.aic_date === d && indById.get(x.indicator_id)?.pillar === p.code).map((x: any) => x.status);
          return { date: d, state: dayState(sts, d, holidays) };
        });
        // Tendance : indicateur « suivi sur le graphe », sinon nombre d'écarts du jour
        const charted = active.filter((i: any) => i.on_chart);
        const ref = charted[0];
        const sameLabel = ref ? charted.filter((i: any) => i.label === ref.label) : [];
        const trend = calendar
          .filter((c) => !isWeekend(c.date) && !holidays.has(c.date) && c.date <= today)
          .map((c) => {
            const ms = monthMeas.filter((x: any) => x.aic_date === c.date);
            if (ref) {
              const vals = ms.filter((x: any) => sameLabel.some((i: any) => i.id === x.indicator_id) && x.value !== null).map((x: any) => x.value);
              if (vals.length === 0) return { date: c.date, value: null, state: c.state };
              const v = ref.aggregation === 'Somme' ? vals.reduce((a: number, b: number) => a + b, 0) : vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
              return { date: c.date, value: Math.round(v * 100) / 100, state: c.state };
            }
            const nok = ms.filter((x: any) => indById.get(x.indicator_id)?.pillar === p.code && x.status === 'NOK').length;
            return { date: c.date, value: nok, state: c.state };
          });
        return {
          ...p,
          state: calendar.find((c) => c.date === date)?.state ?? 0,
          calendar,
          trend: {
            mode: ref ? 'indicator' : 'ecarts',
            label: ref ? ref.label : "Nombre d'écarts",
            unit: ref?.unit ?? 'nb',
            target: ref ? (ref.aggregation === 'Somme' && sameLabel.length > 1 ? Number(ref.target) * sameLabel.length : ref.target) : 0,
            direction: ref?.direction ?? '<=',
            axis: ref ? { min: ref.axis_min, max: ref.axis_max, step: ref.axis_step } : null,
            points: trend,
          },
          entries: active.map((i: any) => {
            const mm: any = todays.get(i.id);
            return {
              indicator_id: i.id, label: i.label, unit: i.unit, target: i.target, direction: i.direction,
              service_id: i.service_id, service_name: i.service_name,
              measurement_id: mm?.id ?? null,
              value: mm?.value ?? null,
              offset: mm ? Math.round((Date.parse(date) - Date.parse(mm.measure_date)) / 86400000) : 0,
              comment: mm?.comment ?? null,
              status: mm?.status ?? null,
            };
          }),
        };
      });

      // Problèmes du jour : commentaires au journal + remontées hors écart créées le jour
      const lvlCond = level >= 2 ? 's.level <= $3' : 's.level = 1 AND s.id = ANY($3)';
      const scopeArg = level >= 2 ? level : ids;
      const problems = await q(
        `SELECT m.id AS measurement_id, s.level, s.name AS service_name, i.pillar, i.label AS indicator, m.comment AS subject,
                m.value, m.target, i.unit, i.direction,
                coalesce((SELECT a.id FROM actions a WHERE a.measurement_id = m.id LIMIT 1),
                         (SELECT a.id FROM actions a WHERE a.site_id = m.site_id AND a.created_on = m.aic_date
                             AND a.indicator_id = m.indicator_id LIMIT 1)) AS action_id
           FROM measurements m JOIN indicators i ON i.id=m.indicator_id JOIN services s ON s.id=i.service_id
          WHERE m.site_id=$1 AND m.aic_date=$2 AND coalesce(m.comment,'')<>'' AND ${lvlCond}
          ORDER BY s.level, s.ord, i.pillar`,
        [siteId, date, scopeArg]);
      const raised = await q(
        `SELECT a.id AS action_id, a.emitter_level AS level, s.name AS service_name, a.pillar, i.label AS indicator, a.subject
           FROM actions a LEFT JOIN services s ON s.id=a.service_id LEFT JOIN indicators i ON i.id=a.indicator_id
          WHERE a.site_id=$1 AND a.created_on=$2 AND a.measurement_id IS NULL
            AND ${level >= 2 ? 'a.emitter_level <= $3' : 'a.emitter_level = 1 AND a.service_id = ANY($3)'}`,
        [siteId, date, scopeArg]);
      const linked = new Set(problems.map((p: any) => p.action_id).filter(Boolean));

      // Actions du niveau (ouvertes + soldées depuis 5 jours ouvrés)
      const acts = await q(
        `SELECT a.*, s.name AS service_name FROM actions a LEFT JOIN services s ON s.id=a.service_id
          WHERE a.site_id=$1 AND a.level=$2 ${level === 1 ? 'AND a.service_id = ANY($3)' : ''}
            AND (a.status NOT IN ('Soldée','Abandonnée') OR a.done_date >= $${level === 1 ? 4 : 3})
          ORDER BY a.due_date NULLS LAST, a.num`,
        level === 1 ? [siteId, level, ids, addDays(date, -7)] : [siteId, level, addDays(date, -7)]);

      return {
        date, level, today,
        services: scope.services,
        pillars,
        toValidate: 0,
        problems: [
          ...problems,
          ...raised.filter((r: any) => !linked.has(r.action_id)),
        ],
        actions: acts.map((a: any) => ({ ...a, ref: actionRef(a.num), state: actionState(a, today) })),
      };
    },
  );

  // Valider l'AIC : enregistre les valeurs saisies et renvoie les écarts à traiter.
  app.post<{ Params: { siteId: string }; Body: { date: string; entries: { indicator_id: number; value: number | null; offset?: number; comment?: string | null }[] } }>(
    '/api/sites/:siteId/aic/validate',
    { preHandler: requireRole('admin', 'animateur') },
    async (req, reply) => {
      const siteId = Number(req.params.siteId);
      const { date, entries } = req.body ?? ({} as any);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Array.isArray(entries)) {
        return reply.code(400).send({ error: 'Date ou saisies invalides' });
      }
      const user = req.user!.name;
      return tx(async (c) => {
        let added = 0, updated = 0, removed = 0;
        const ecarts: any[] = [];
        for (const e of entries) {
          const ind = (await c.query('SELECT * FROM indicators WHERE id=$1 AND site_id=$2', [e.indicator_id, siteId])).rows[0];
          if (!ind) continue;
          const value = e.value === null || e.value === undefined || (e.value as any) === '' ? null : Number(e.value);
          const comment = e.comment?.trim() || null;
          const existing = (await c.query('SELECT * FROM measurements WHERE indicator_id=$1 AND aic_date=$2', [ind.id, date])).rows[0];
          if (value === null && !comment) {
            if (existing) {
              await c.query('DELETE FROM measurements WHERE id=$1', [existing.id]);
              removed++;
            }
            continue;
          }
          const status = measureStatus(value, ind.target, ind.direction as Direction);
          const dmes = measureDate(date, e.offset ?? 0);
          let id: number;
          if (existing) {
            if (existing.value === value && existing.comment === comment && existing.measure_date === dmes) {
              id = existing.id;
            } else {
              await c.query(
                `UPDATE measurements SET value=$1, target=$2, status=$3, comment=$4, measure_date=$5, updated_by=$6, updated_at=now() WHERE id=$7`,
                [value, ind.target, status, comment, dmes, user, existing.id]);
              updated++;
              id = existing.id;
            }
          } else {
            id = (await c.query(
              `INSERT INTO measurements(site_id, indicator_id, aic_date, measure_date, value, target, status, comment, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [siteId, ind.id, date, dmes, value, ind.target, status, comment, user])).rows[0].id;
            added++;
          }
          if (status === 'NOK') {
            const hasAction = (await c.query('SELECT id FROM actions WHERE measurement_id=$1 LIMIT 1', [id])).rows[0];
            ecarts.push({
              measurement_id: id, indicator_id: ind.id, service_id: ind.service_id, pillar: ind.pillar,
              label: ind.label, value, target: ind.target, unit: ind.unit, direction: ind.direction,
              comment, action_id: hasAction?.id ?? null,
            });
          }
        }
        return { added, updated, removed, ecarts };
      });
    },
  );
}
