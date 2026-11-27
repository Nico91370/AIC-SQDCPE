import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { one, q, tx } from '../db.ts';
import { requireRole } from '../auth.ts';
import { STATUSES, actionRef, actionState, applyStatus, nextPdca, nextStatus, todayIso, type ActionStatus } from '../domain.ts';

const EDITABLE = [
  'requested_by', 'service_id', 'pillar', 'responsibility', 'origin', 'indicator_id', 'measurement_id', 'typology',
  'criticality', 'subject', 'cause', 'action', 'owner', 'priority', 'due_date', 'outcome',
  'escalation_reason', 'escalation_answer', 'emitter_level',
] as const;

async function trace(c: pg.PoolClient, actionId: number, author: string, text: string) {
  await c.query('INSERT INTO action_history(action_id, author, text) VALUES ($1,$2,$3)', [actionId, author, text]);
}

async function load(siteId: number, id: number) {
  const a = await one(
    `SELECT a.*, s.name AS service_name, i.label AS indicator_label FROM actions a
       LEFT JOIN services s ON s.id=a.service_id LEFT JOIN indicators i ON i.id=a.indicator_id
      WHERE a.site_id=$1 AND a.id=$2`, [siteId, id]);
  if (!a) return null;
  const history = await q('SELECT at, author, text FROM action_history WHERE action_id=$1 ORDER BY at, id', [id]);
  return { ...a, ref: actionRef(a.num), state: actionState(a, todayIso()), history };
}

function httpError(msg: string, code = 400) {
  return Object.assign(new Error(msg), { statusCode: code });
}

/** Applique statut et niveau avec leurs règles (macros PoserStatut / PoserNiveau), puis les autres champs. */
async function writeAction(c: pg.PoolClient, siteId: number, id: number, body: any, author: string) {
  const cur = (await c.query('SELECT * FROM actions WHERE id=$1 AND site_id=$2 FOR UPDATE', [id, siteId])).rows[0];
  if (!cur) return false;
  const changes = new Map<string, unknown>();
  const set = (k: string, v: unknown) => changes.set(k, v === '' ? null : v);
  for (const k of EDITABLE) if (k in body && body[k] !== cur[k]) set(k, body[k]);
  if (body.pdca && body.pdca !== cur.pdca) {
    if (!'PDCA'.includes(body.pdca) || body.pdca.length !== 1) throw httpError('PDCA invalide');
    set('pdca', body.pdca);
    await trace(c, id, author, `PDCA en ${body.pdca}`);
  }
  if (body.status && body.status !== cur.status) {
    if (!STATUSES.includes(body.status)) throw httpError('Statut inconnu');
    const ch = applyStatus(cur, body.status as ActionStatus, todayIso());
    set('status', ch.status);
    if (ch.pdca && !body.pdca) set('pdca', ch.pdca);
    if ('done_date' in ch) set('done_date', body.done_date ?? ch.done_date);
    if (ch.trace) await trace(c, id, author, ch.trace);
  } else if ('done_date' in body && body.done_date !== cur.done_date) {
    set('done_date', body.done_date);
  }
  if (body.level && Number(body.level) !== cur.level) {
    const n = Number(body.level);
    if (!(n >= 1 && n <= 3)) throw httpError('Niveau invalide');
    set('level', n);
    const why = String(body.escalation_reason ?? '').trim();
    await trace(c, id, author, `N${cur.level} vers N${n}${why && n > cur.level ? ` (${why})` : ''}`);
  }
  if (changes.size) {
    const keys = [...changes.keys()];
    const sql = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    await c.query(`UPDATE actions SET ${sql} WHERE id=$${keys.length + 1}`, [...changes.values(), id]);
  }
  return true;
}

export default async function actionRoutes(app: FastifyInstance) {
  const write = { preHandler: requireRole('admin', 'animateur') };

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string | undefined> }>(
    '/api/sites/:siteId/actions',
    async (req) => {
      const siteId = Number(req.params.siteId);
      const f = req.query;
      const where = ['a.site_id=$1'];
      const p: unknown[] = [siteId];
      const add = (build: (ph: string) => string, v: unknown) => { p.push(v); where.push(build(`$${p.length}`)); };
      if (f.level) add((x) => `a.level=${x}`, Number(f.level));
      if (f.service) add((x) => `a.service_id=${x}`, Number(f.service));
      if (f.pillar) add((x) => `a.pillar=${x}`, f.pillar);
      if (f.status) add((x) => `a.status=${x}`, f.status);
      if (f.open === '1') where.push(`a.status NOT IN ('Soldée','Abandonnée')`);
      if (f.search) {
        add((x) => `(a.subject ILIKE ${x} OR coalesce(a.action,'') ILIKE ${x} OR coalesce(a.owner,'') ILIKE ${x})`, `%${f.search}%`);
      }
      const rows = await q(
        `SELECT a.*, s.name AS service_name, i.label AS indicator_label FROM actions a
           LEFT JOIN services s ON s.id=a.service_id LEFT JOIN indicators i ON i.id=a.indicator_id
          WHERE ${where.join(' AND ')} ORDER BY a.num DESC`, p);
      const today = todayIso();
      let out = rows.map((a: any) => ({ ...a, ref: actionRef(a.num), state: actionState(a, today) }));
      if (f.state) out = out.filter((a) => a.state === f.state);
      return out;
    },
  );

  app.get<{ Params: { siteId: string; id: string } }>('/api/sites/:siteId/actions/:id', async (req, reply) => {
    const a = await load(Number(req.params.siteId), Number(req.params.id));
    return a ?? reply.code(404).send({ error: 'Action introuvable' });
  });

  app.post<{ Params: { siteId: string }; Body: any }>('/api/sites/:siteId/actions', write, async (req, reply) => {
    const siteId = Number(req.params.siteId);
    const b: any = req.body ?? {};
    if (!String(b.subject ?? '').trim()) return reply.code(400).send({ error: 'Le problème est obligatoire' });
    const author = req.user!.name;
    const id = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [siteId]);
      const num = (await c.query('SELECT coalesce(max(num),0)+1 AS n FROM actions WHERE site_id=$1', [siteId])).rows[0].n;
      const level = Number(b.level ?? 1);
      const r = (await c.query(
        `INSERT INTO actions(site_id, num, created_on, requested_by, service_id, level, emitter_level, subject)
         VALUES ($1,$2,coalesce($3::date,current_date),$4,$5,$6,$6,$7) RETURNING id`,
        [siteId, num, b.created_on ?? null, b.requested_by ?? author, b.service_id ?? null, level, String(b.subject).trim()])).rows[0];
      await trace(c, r.id, author, `Créée en N${level}`);
      const { level: _l, created_on: _c, ...rest } = b;
      await writeAction(c, siteId, r.id, rest, author);
      // Comme la fiche Excel : le problème déclaré sur un écart devient le commentaire de la mesure.
      if (b.measurement_id) {
        await c.query(
          `UPDATE measurements SET comment=$1 WHERE id=$2 AND site_id=$3 AND coalesce(comment,'')=''`,
          [String(b.subject).trim(), b.measurement_id, siteId]);
      }
      return r.id as number;
    });
    return load(siteId, id);
  });

  app.patch<{ Params: { siteId: string; id: string }; Body: any }>('/api/sites/:siteId/actions/:id', write, async (req, reply) => {
    const siteId = Number(req.params.siteId);
    const id = Number(req.params.id);
    const ok = await tx((c) => writeAction(c, siteId, id, req.body ?? {}, req.user!.name));
    return ok ? load(siteId, id) : reply.code(404).send({ error: 'Action introuvable' });
  });

  // Gestes rapides : avancer le statut, le PDCA, monter ou descendre d'un niveau.
  app.post<{ Params: { siteId: string; id: string }; Body: { what: 'status' | 'pdca' | 'up' | 'down'; reason?: string; outcome?: string } }>(
    '/api/sites/:siteId/actions/:id/step', write, async (req, reply) => {
      const siteId = Number(req.params.siteId);
      const id = Number(req.params.id);
      const cur = await one('SELECT * FROM actions WHERE id=$1 AND site_id=$2', [id, siteId]);
      if (!cur) return reply.code(404).send({ error: 'Action introuvable' });
      const b = req.body ?? ({} as any);
      const patch: any = {};
      if (b.what === 'status') {
        patch.status = nextStatus(cur.status);
        if (patch.status === 'Soldée' && b.outcome) patch.outcome = b.outcome;
      } else if (b.what === 'pdca') {
        patch.pdca = nextPdca(cur.pdca);
      } else if (b.what === 'up' || b.what === 'down') {
        const n = cur.level + (b.what === 'up' ? 1 : -1);
        if (n < 1 || n > 3) return reply.code(400).send({ error: "Il n'y a pas de niveau au-delà de celui-ci." });
        patch.level = n;
        if (b.reason) patch.escalation_reason = b.reason;
      } else {
        return reply.code(400).send({ error: 'Geste inconnu' });
      }
      await tx((c) => writeAction(c, siteId, id, patch, req.user!.name));
      return load(siteId, id);
    });

  app.delete<{ Params: { siteId: string; id: string } }>('/api/sites/:siteId/actions/:id',
    { preHandler: requireRole('admin') }, async (req) => {
      await q('DELETE FROM actions WHERE site_id=$1 AND id=$2', [Number(req.params.siteId), Number(req.params.id)]);
      return { ok: true };
    });
}
