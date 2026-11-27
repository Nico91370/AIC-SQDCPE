import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSearchParams } from 'react-router-dom';
import { MONTHS, api, dirSign, fmtDate, fmtNum, todayIso } from '../api.ts';
import { useApp } from '../App.tsx';
import ActionForm, { QuickSteps, slug, type ActionRow, type Draft } from '../ActionForm.tsx';

interface Entry {
  indicator_id: number; label: string; unit: string | null; target: number | null; direction: string;
  service_id: number; service_name: string; measurement_id: number | null; value: number | null;
  offset: number; comment: string | null; status: 'OK' | 'NOK' | null;
}
interface Pillar {
  code: string; name: string; state: number;
  calendar: { date: string; state: number }[];
  trend: { mode: string; label: string; unit: string; target: number | null; direction: string; axis: any; points: { date: string; value: number | null; state: number }[] };
  entries: Entry[];
}
interface AicData {
  date: string; level: number; today: string; services: any[]; pillars: Pillar[];
  problems: any[]; actions: ActionRow[];
}
interface Ecart {
  measurement_id: number; indicator_id: number; service_id: number; pillar: string; label: string;
  value: number; target: number; unit: string | null; direction: string; comment: string | null; action_id: number | null;
}

const COLORS = { 1: 'var(--ok)', 2: 'var(--nok)', 3: 'var(--off)', 0: 'var(--none)' } as Record<number, string>;
const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export default function Aic() {
  const { siteId, config, user, canWrite } = useApp();
  const [params, setParams] = useSearchParams();
  const level = Number(params.get('level') ?? 1);
  const levelServices = config.services.filter((s) => s.level === level);
  const service = params.get('service') ?? (level === 1 ? 'all' : String(levelServices[0]?.id ?? 'all'));
  const date = params.get('date') ?? todayIso();
  const [data, setData] = useState<AicData | null>(null);
  const [edits, setEdits] = useState<Record<number, { value: string; offset: number; comment: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [queue, setQueue] = useState<Ecart[]>([]);
  const [form, setForm] = useState<Draft | null>(null);

  const setP = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    n.set(k, v);
    if (k === 'level') n.delete('service');
    setParams(n, { replace: true });
  };

  async function load() {
    const d = await api<AicData>(`/api/sites/${siteId}/aic?level=${level}&service=${service}&date=${date}`);
    setData(d);
    setEdits({});
  }
  useEffect(() => { setData(null); load().catch((e) => setMsg(e.message)); }, [siteId, level, service, date]);

  const entries = useMemo(() => data?.pillars.flatMap((p) => p.entries) ?? [], [data]);
  const changed = entries.filter((e) => {
    const x = edits[e.indicator_id];
    if (!x) return false;
    const v = x.value === '' ? null : Number(x.value.replace(',', '.'));
    return v !== e.value || x.offset !== e.offset || (x.comment || null) !== (e.comment || null);
  });

  async function validate() {
    if (!data) return;
    if (changed.length === 0) {
      setMsg("Rien de nouveau à enregistrer : les cases de saisie correspondent déjà au journal.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ added: number; updated: number; removed: number; ecarts: Ecart[] }>(
        `/api/sites/${siteId}/aic/validate`,
        {
          body: {
            date,
            entries: changed.map((e) => {
              const x = edits[e.indicator_id];
              return { indicator_id: e.indicator_id, value: x.value === '' ? null : Number(x.value.replace(',', '.')), offset: x.offset, comment: x.comment };
            }),
          },
        });
      const todo = res.ecarts.filter((e) => !e.action_id);
      setMsg(`AIC du ${fmtDate(date)} enregistrée : ${res.added} mesure(s) ajoutée(s), ${res.updated} mise(s) à jour` +
        (res.removed ? `, ${res.removed} effacée(s)` : '') +
        (todo.length ? `. ${todo.length} écart(s) à la cible : la fiche va s'ouvrir pour chacun.` : '.'));
      await load();
      setQueue(todo);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  // File d'attente des écarts : une fiche par écart
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    setForm({
      level, service_id: current.service_id, pillar: current.pillar, indicator_id: current.indicator_id,
      measurement_id: current.measurement_id, created_on: date, requested_by: user.name,
      origin: config.lists.origine?.[0] ?? 'Écart indicateur',
      subject: current.comment || `${current.label} : ${fmtNum(current.value, current.unit)} pour une cible ${dirSign(current.direction)} ${fmtNum(current.target, current.unit)}`,
      status: 'À faire', pdca: 'P', emitter_level: level,
    });
  }, [current?.measurement_id]);

  const nextInQueue = () => { setForm(null); setQueue((q) => q.slice(1)); load(); };

  if (!data) return <div className="loading">Chargement de l'écran d'AIC…</div>;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const svc = levelServices.find((s) => String(s.id) === service);
  const animator = (svc ?? levelServices[0])?.animator;
  const shift = (days: number) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    setP('date', d.toISOString().slice(0, 10));
  };
  const multi = level === 1 && service === 'all';

  return (
    <div className="aic">
      <div className="toolbar">
        <label>Niveau
          <select value={level} onChange={(e) => setP('level', e.target.value)}>
            {config.levels.map((l) => <option key={l.level} value={l.level}>N{l.level} · {l.instance}</option>)}
          </select>
        </label>
        <label>Service
          <select value={service} onChange={(e) => setP('service', e.target.value)}>
            {level === 1 && <option value="all">Tous les services</option>}
            {levelServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Jour
          <span className="daynav">
            <button className="btn small" onClick={() => shift(-1)} aria-label="Jour précédent">◀</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setP('date', e.target.value)} />
            <button className="btn small" onClick={() => shift(1)} aria-label="Jour suivant">▶</button>
            <button className="btn small" onClick={() => setP('date', todayIso())}>Aujourd'hui</button>
          </span>
        </label>
        <div className="toolbar-info">
          <div className="muted small">{MONTHS[m - 1]} {y}</div>
          {animator && <div className="small">Animé par <b>{animator}</b></div>}
        </div>
      </div>

      {msg && <div className="notice" onClick={() => setMsg(null)}>{msg}</div>}

      <div className="pillars">
        {data.pillars.map((p) => (
          <section key={p.code} className="pillar">
            <div className="pillar-head">
              <span className="letter" style={{ color: COLORS[p.state] ?? COLORS[0] }}>{p.code}</span>
              <div>
                <div className="pillar-name">{p.name}</div>
                <div className="muted small">{p.trend.label}{p.trend.mode === 'indicator' && p.trend.target !== null ? ` · cible ${dirSign(p.trend.direction)} ${fmtNum(p.trend.target, p.trend.unit)}` : ''}</div>
              </div>
            </div>
            <MonthGrid cal={p.calendar} selected={date} onPick={(d) => setP('date', d)} />
            <div className="trend">
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={p.trend.points} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
                  <XAxis dataKey="date" tickFormatter={(d) => String(Number(d.slice(8)))} fontSize={10} interval="preserveStartEnd" tickLine={false} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} allowDecimals={p.trend.mode === 'indicator'}
                    domain={[p.trend.axis?.min ?? 'auto', p.trend.axis?.max ?? 'auto']} />
                  <Tooltip formatter={(v: any) => fmtNum(v, p.trend.unit)} labelFormatter={(d: any) => fmtDate(String(d))} />
                  {p.trend.target !== null && p.trend.mode === 'indicator' && (
                    <ReferenceLine y={p.trend.target} stroke="var(--ink-2)" strokeDasharray="4 3" />
                  )}
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {p.trend.points.map((pt) => (
                      <Cell key={pt.date} fill={pt.date === date ? 'var(--accent)' : p.trend.mode === 'ecarts' ? 'var(--nok)' : COLORS[pt.state] ?? COLORS[0]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="entries">
              <thead>
                <tr><th>Indicateur · cible</th><th>Résultat · mesure</th></tr>
              </thead>
              <tbody>
                {p.entries.length === 0 && <tr><td colSpan={2} className="muted small">Aucun indicateur actif</td></tr>}
                {p.entries.map((e) => {
                  const x = edits[e.indicator_id] ?? { value: e.value === null ? '' : String(e.value), offset: e.offset, comment: e.comment ?? '' };
                  const upd = (patch: Partial<typeof x>) => setEdits((s) => ({ ...s, [e.indicator_id]: { ...x, ...patch } }));
                  const isDirty = changed.includes(e);
                  return (
                    <tr key={e.indicator_id} className={isDirty ? 'dirty' : ''}>
                      <td>
                        <span className={`dot ${e.status ? e.status.toLowerCase() : ''}`} />
                        {e.label}
                        {multi && <span className="muted"> · {e.service_name}</span>}
                        <div className="muted small">cible {dirSign(e.direction)} {fmtNum(e.target, e.unit)}</div>
                      </td>
                      <td className="cell-input">
                        <span className="val-row">
                          <input className="num" inputMode="decimal" value={x.value} disabled={!canWrite}
                            aria-label={`Résultat ${e.label}${multi ? ' ' + e.service_name : ''}`}
                            onChange={(ev) => upd({ value: ev.target.value })} />
                          <select value={x.offset} disabled={!canWrite} onChange={(ev) => upd({ offset: Number(ev.target.value) })} aria-label="Jour mesuré" title="Jour auquel la mesure se rapporte">
                            <option value={0}>J</option><option value={1}>J-1</option><option value={2}>J-2</option>
                          </select>
                        </span>
                        <input className="comment" placeholder="Commentaire" value={x.comment} disabled={!canWrite}
                          aria-label={`Commentaire ${e.label}`}
                          onChange={(ev) => upd({ comment: ev.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      {canWrite && (
        <div className="validate-bar">
          <span>{changed.length ? `${changed.length} valeur(s) à enregistrer` : 'Saisie à jour'}</span>
          <button className="btn" onClick={() => setForm({ level, service_id: svc?.id ?? levelServices[0]?.id, created_on: date, requested_by: user.name, origin: config.lists.origine?.[1], status: 'À faire', pdca: 'P' })}>
            Déclarer un problème
          </button>
          <button className="btn primary big" onClick={validate} disabled={busy}>{busy ? 'Enregistrement…' : "Valider l'AIC"}</button>
        </div>
      )}

      <div className="aic-bottom">
        <section className="panel">
          <h3>Problèmes du jour <span className="count">{data.problems.length}</span></h3>
          {data.problems.length === 0 && <p className="muted small">Aucun problème remonté le {fmtDate(date)}.</p>}
          <ul className="problems">
            {data.problems.map((pb, i) => (
              <li key={i}>
                <span className="tag">N{pb.level}</span>
                <span className="tag pillar-tag">{pb.pillar}</span>
                <b>{pb.service_name}</b> {pb.indicator && <span className="muted">· {pb.indicator}</span>}
                <div>{pb.subject}</div>
                {pb.action_id
                  ? <button className="link" onClick={() => setForm({ id: pb.action_id })}>Voir l'action</button>
                  : canWrite && pb.measurement_id && (
                    <button className="link" onClick={() => setForm({
                      level, service_id: config.services.find((s) => s.name === pb.service_name)?.id, pillar: pb.pillar,
                      measurement_id: pb.measurement_id, subject: pb.subject, created_on: date, requested_by: user.name,
                      origin: config.lists.origine?.[0], status: 'À faire', pdca: 'P',
                      indicator_id: config.indicators.find((i) => i.label === pb.indicator && config.services.find((s) => s.id === i.service_id)?.name === pb.service_name)?.id,
                    })}>Créer une action</button>
                  )}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h3>Plan d'actions N{level} <span className="count">{data.actions.filter((a) => a.status !== 'Soldée' && a.status !== 'Abandonnée').length} ouvertes</span></h3>
          <table className="list">
            <thead><tr><th>Réf</th><th>Thème</th><th>Problème / action</th><th>Porteur</th><th>Échéance</th><th>État</th><th /></tr></thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setForm({ id: a.id })}>
                  <td className="nowrap">{a.ref}{a.emitter_level < a.level && <span className="tag up" title={`Remontée de N${a.emitter_level}`}>↑N{a.emitter_level}</span>}</td>
                  <td><span className="tag pillar-tag">{a.pillar}</span></td>
                  <td><div>{a.subject}</div>{a.action && <div className="muted small">{a.action}</div>}</td>
                  <td>{a.owner}</td>
                  <td className="nowrap">{fmtDate(a.due_date)}</td>
                  <td><span className={`state-pill st-${slug(a.state)}`}>{a.state}</span></td>
                  <td onClick={(e) => e.stopPropagation()}><QuickSteps a={a} onChange={() => load()} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {form && (
        <ActionForm
          initial={form}
          title={current ? `Écart ${queue.length > 1 ? `(1 / ${queue.length}) ` : ''}· ${current.label}` : undefined}
          onClose={() => (current ? nextInQueue() : setForm(null))}
          onSaved={() => (current ? nextInQueue() : (setForm(null), load()))}
          extraButtons={current && (
            <button className="btn" onClick={nextInQueue} title="Laisser l'écart sans action">Sans action</button>
          )}
        />
      )}
    </div>
  );
}

function MonthGrid({ cal, selected, onPick }: { cal: { date: string; state: number }[]; selected: string; onPick: (d: string) => void }) {
  const firstWd = (new Date(cal[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return (
    <div className="month">
      {WEEK.map((w, i) => <span key={i} className="wd">{w}</span>)}
      {Array.from({ length: firstWd }, (_, i) => <span key={'e' + i} />)}
      {cal.map((c) => (
        <button key={c.date} className={`day s${c.state}${c.date === selected ? ' sel' : ''}`} onClick={() => onPick(c.date)}
          title={fmtDate(c.date)}>{Number(c.date.slice(8))}</button>
      ))}
    </div>
  );
}
