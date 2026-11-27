// Import du classeur Excel « AIC SQDCPE » dans la base de données.
//
//   npm run import:excel -- <fichier.xlsm> [--site "Nom du site"] [--replace]
//
// Reprend les référentiels (niveaux, services, indicateurs, équipe, listes, jours
// fériés), le Journal des mesures et le plan d'actions. Avec --replace, les données
// existantes du site sont effacées avant l'import.

import ExcelJS from 'exceljs';
import { pool, tx } from '../server/db.ts';
import { migrate } from '../server/migrate.ts';
import { measureStatus, type Direction } from '../server/domain.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--site');
const siteName = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'Site principal';
const replace = args.includes('--replace');
if (!file) {
  console.error('Usage : npm run import:excel -- <fichier.xlsm> [--site "Nom du site"] [--replace]');
  process.exit(1);
}

function raw(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return raw((v as any).result);
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('');
    if ('text' in v) return (v as any).text;
    if ('error' in v) return null;
    if ('formula' in v || 'sharedFormula' in v) return null;
  }
  return v;
}
function text(v: ExcelJS.CellValue): string | null {
  const r = raw(v);
  if (r === null || r === undefined) return null;
  const s = String(r).trim();
  return s ? s : null;
}
function num(v: ExcelJS.CellValue): number | null {
  const r = raw(v);
  if (r === null || r === undefined || r === '') return null;
  const n = typeof r === 'number' ? r : Number(String(r).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function date(v: ExcelJS.CellValue): string | null {
  const r = raw(v);
  if (r instanceof Date) return r.toISOString().slice(0, 10);
  if (typeof r === 'number') return new Date(Date.UTC(1899, 11, 30) + r * 86400000).toISOString().slice(0, 10);
  if (typeof r === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(r)) {
    const [d, m, y] = r.split('/');
    return `${y}-${m}-${d}`;
  }
  return null;
}
const lvl = (v: ExcelJS.CellValue) => {
  const m = /N\s*([123])/.exec(text(v) ?? '');
  return m ? Number(m[1]) : null;
};
const dir = (v: ExcelJS.CellValue): Direction => ((text(v) ?? '').includes('≤') || text(v) === '<=' ? '<=' : '>=');
const yes = (v: ExcelJS.CellValue) => (text(v) ?? '').toLowerCase().startsWith('o');

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheet = (name: string) => {
  const ws = wb.worksheets.find((w) => w.name.normalize('NFC') === name.normalize('NFC'));
  if (!ws) throw new Error(`Onglet « ${name} » introuvable`);
  return ws;
};
const P = sheet('Paramètres');
const EQ = sheet('Équipe');
const IND = sheet('Indicateurs');
const J = sheet('Journal');
const A = sheet('Actions');

function column(ws: ExcelJS.Worksheet, col: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let r = from; r <= to; r++) {
    const t = text(ws.getCell(`${col}${r}`).value);
    if (t) out.push(t);
  }
  return out;
}

await migrate();

const stats = await tx(async (c) => {
  let site = (await c.query('SELECT id FROM sites WHERE name=$1', [siteName])).rows[0];
  if (site && replace) {
    await c.query('DELETE FROM sites WHERE id=$1', [site.id]);
    site = undefined;
  } else if (site) {
    throw new Error(`Le site « ${siteName} » existe déjà. Relancez avec --replace pour le réimporter.`);
  }
  site = (await c.query('INSERT INTO sites(name) VALUES ($1) RETURNING id', [siteName])).rows[0];
  const siteId: number = site.id;

  // Niveaux
  for (let r = 10; r <= 12; r++) {
    const n = lvl(P.getCell(`N${r}`).value);
    if (n) await c.query('INSERT INTO levels(site_id, level, instance) VALUES ($1,$2,$3)', [siteId, n, text(P.getCell(`O${r}`).value) ?? `N${n}`]);
  }

  // Services : périmètres d'animation de l'onglet Équipe, complétés par les indicateurs
  const services = new Map<string, number>();
  let ord = 0;
  const addService = async (name: string, level: number, animator: string | null = null, deputy: string | null = null) => {
    if (services.has(name)) return;
    const id = (await c.query(
      'INSERT INTO services(site_id, name, level, ord, animator, deputy) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [siteId, name, level, ord++, animator, deputy])).rows[0].id;
    services.set(name, id);
  };
  for (let r = 6; r <= 20; r++) {
    const n = lvl(EQ.getCell(`F${r}`).value);
    const s = text(EQ.getCell(`G${r}`).value);
    if (n && s) await addService(s, n, text(EQ.getCell(`H${r}`).value), text(EQ.getCell(`I${r}`).value));
  }
  for (let r = 4; r <= 203; r++) {
    const n = lvl(IND.getCell(`B${r}`).value);
    const s = text(IND.getCell(`C${r}`).value);
    if (n && s) await addService(s, n);
  }

  // Indicateurs
  const indicators = new Map<string, { id: number; target: number | null; direction: Direction }>();
  for (let r = 4; r <= 203; r++) {
    const s = text(IND.getCell(`C${r}`).value);
    const label = text(IND.getCell(`E${r}`).value);
    const pillar = text(IND.getCell(`D${r}`).value);
    if (!s || !label || !pillar || !services.has(s)) continue;
    const key = `${s}|${label}`;
    if (indicators.has(key)) continue;
    const target = num(IND.getCell(`G${r}`).value);
    const direction = dir(IND.getCell(`H${r}`).value);
    const agg = text(IND.getCell(`K${r}`).value);
    const id = (await c.query(
      `INSERT INTO indicators(site_id, service_id, pillar, label, unit, target, direction, active, on_chart, aggregation, axis_min, axis_max, axis_step, ord)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [siteId, services.get(s), pillar.slice(0, 1).toUpperCase(), label, text(IND.getCell(`F${r}`).value), target, direction,
        yes(IND.getCell(`I${r}`).value), yes(IND.getCell(`J${r}`).value),
        agg === 'Moyenne' || agg === 'Dernier' ? agg : 'Somme',
        num(IND.getCell(`L${r}`).value), num(IND.getCell(`M${r}`).value), num(IND.getCell(`N${r}`).value), r])).rows[0].id;
    indicators.set(key, { id, target, direction });
  }

  // Équipe
  for (let r = 6; r <= 40; r++) {
    const name = text(EQ.getCell(`B${r}`).value);
    if (name) {
      await c.query('INSERT INTO people(site_id, name, function, service) VALUES ($1,$2,$3,$4)',
        [siteId, name, text(EQ.getCell(`C${r}`).value), text(EQ.getCell(`D${r}`).value)]);
    }
  }

  // Listes
  const lists: Record<string, string[]> = {
    typologie: column(P, 'AB', 10, 29),
    criticite: column(P, 'X', 10, 12),
    responsabilite: column(P, 'W', 10, 13),
    origine: column(P, 'AC', 10, 11),
    priorite: column(P, 'U', 22, 24),
    escalade: column(P, 'AD', 10, 12),
    suite: column(P, 'AE', 10, 11),
  };
  for (const [kind, values] of Object.entries(lists)) {
    for (const [i, v] of [...new Set(values)].entries()) {
      await c.query('INSERT INTO list_values(site_id, kind, value, ord) VALUES ($1,$2,$3,$4)', [siteId, kind, v, i]);
    }
  }

  // Jours fériés
  for (let r = 10; r <= 79; r++) {
    const d = date(P.getCell(`L${r}`).value);
    if (d) await c.query('INSERT INTO holidays(site_id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING', [siteId, d]);
  }

  // Journal des mesures
  let nMeas = 0, skipped = 0;
  const byKey = new Map<string, unknown[]>(); // une mesure par indicateur et par jour : la dernière ligne l'emporte
  J.eachRow((row, r) => {
    if (r < 4) return;
    const aic = date(row.getCell(1).value);
    const s = text(row.getCell(3).value);
    const label = text(row.getCell(4).value);
    if (!aic || !s || !label) return;
    const ind = indicators.get(`${s}|${label}`);
    if (!ind) { skipped++; return; }
    const value = num(row.getCell(6).value);
    const comment = text(row.getCell(7).value);
    if (value === null && !comment) return;
    byKey.set(`${ind.id}|${aic}`, [siteId, ind.id, aic, date(row.getCell(2).value) ?? aic, value, ind.target,
      measureStatus(value, ind.target, ind.direction), comment]);
  });
  const rows = [...byKey.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const ph = chunk.map((_, k) => `(${Array.from({ length: 8 }, (_, j) => `$${k * 8 + j + 1}`).join(',')},'Import Excel')`).join(',');
    const res = await c.query(
      `INSERT INTO measurements(site_id, indicator_id, aic_date, measure_date, value, target, status, comment, updated_by)
       VALUES ${ph}
       ON CONFLICT (indicator_id, aic_date) DO UPDATE SET value=EXCLUDED.value, measure_date=EXCLUDED.measure_date,
         status=EXCLUDED.status, comment=EXCLUDED.comment`,
      chunk.flat());
    nMeas += res.rowCount ?? 0;
  }

  // Plan d'actions
  let nAct = 0;
  for (let r = 6; r <= 505; r++) {
    const g = (col: string) => A.getCell(`${col}${r}`).value;
    const subject = text(g('P'));
    if (!subject) continue;
    const svc = text(g('E'));
    const indLabel = text(g('M'));
    const ind = svc && indLabel ? indicators.get(`${svc}|${indLabel}`) : undefined;
    const st = text(g('V'));
    const status = st && ['À faire', 'En cours', 'Soldée', 'Abandonnée'].includes(st) ? st : 'À faire';
    const pdca = (text(g('W')) ?? 'P').slice(0, 1).toUpperCase();
    const id = (await c.query(
      `INSERT INTO actions(site_id, num, created_on, requested_by, service_id, level, emitter_level, pillar, responsibility,
         origin, indicator_id, typology, criticality, subject, cause, action, owner, priority, due_date, status, pdca,
         done_date, outcome, escalation_reason, escalation_answer)
       VALUES ($1,$2,coalesce($3,current_date),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING id`,
      [siteId, r - 5, date(g('C')), text(g('D')), svc ? services.get(svc) ?? null : null, lvl(g('G')) ?? 1, lvl(g('H')) ?? lvl(g('G')) ?? 1,
        (text(g('J')) ?? '').slice(0, 1).toUpperCase() || null, text(g('K')), text(g('L')), ind?.id ?? null,
        text(g('N')), text(g('O')), subject, text(g('Q')), text(g('R')), text(g('S')), text(g('T')),
        date(g('U')), status, 'PDCA'.includes(pdca) ? pdca : 'P', date(g('X')), text(g('Y')), text(g('Z')), text(g('AA'))])).rows[0].id;
    const hist = text(g('AB'));
    for (const h of (hist ?? '').split('·').map((s) => s.trim()).filter(Boolean)) {
      await c.query("INSERT INTO action_history(action_id, author, text) VALUES ($1,'Import Excel',$2)", [id, h]);
    }
    nAct++;
  }

  return { siteId, services: services.size, indicators: indicators.size, measurements: nMeas, skipped, actions: nAct };
});

console.log(`Import terminé pour « ${siteName} » :`, stats);
await pool.end();
