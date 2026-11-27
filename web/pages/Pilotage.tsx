import { Fragment, useEffect, useState } from 'react';
import { MONTHS, api, pct } from '../api.ts';
import { useApp } from '../App.tsx';

const COLS: [string, string, (v: any) => string][] = [
  ['open', 'Actions ouvertes', String],
  ['late', 'dont en retard', String],
  ['dueSoon', 'Échéance sous 7 jours', String],
  ['raised', "Remontées d'un niveau inférieur", String],
  ['avgAge', 'Âge moyen (j)', (v) => (v === null ? '—' : String(v))],
  ['gca', 'Ouvertes GCA', String],
  ['client', 'Ouvertes Client', String],
  ['closed', 'Soldées sur le mois', String],
  ['avgDelay', 'Délai moyen de résolution (j)', (v) => (v === null ? '—' : String(v))],
  ['onTime', 'Soldées dans les délais', pct],
  ['problems', 'Problèmes du mois', String],
  ['ecarts', 'Écarts à la cible', String],
  ['conformity', 'Conformité du mois', pct],
];

export default function Pilotage() {
  const { siteId } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api(`/api/sites/${siteId}/pilotage?year=${year}&month=${month}`).then(setD); }, [siteId, year, month]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Pilotage · synthèse par niveau</h1>
        <span className="grow" />
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mois">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" className="year" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Année" />
      </div>
      {!d ? <div className="loading">Calcul…</div> : (
        <>
          <div className="kpis">
            <Kpi label="Actions ouvertes" value={d.site.open} />
            <Kpi label="En retard" value={d.site.late} tone={d.site.late ? 'bad' : undefined} />
            <Kpi label="Soldées sur le mois" value={d.site.closed} />
            <Kpi label="Délai moyen de résolution" value={d.site.avgDelay === null ? '—' : `${d.site.avgDelay} j`} />
            <Kpi label="Problèmes du mois" value={d.site.problems} />
            <Kpi label="Conformité du mois" value={pct(d.site.conformity)} />
          </div>
          <p className="muted small">Actions : situation à ce jour. Problèmes, écarts et conformité : journal des mesures sur le mois choisi.</p>

          <h2>Par niveau et par service</h2>
          <div className="scroll-x">
            <table className="list grid">
              <thead><tr><th>Niveau / service</th>{COLS.map((c) => <th key={c[0]}>{c[1]}</th>)}</tr></thead>
              <tbody>
                {d.byLevel.map((l: any) => (
                  <Fragment key={l.level}>
                    {l.services.map((s: any) => (
                      <tr key={s.id}><td>N{l.level} · {s.name}</td>{COLS.map((c) => <td key={c[0]}>{c[2](s[c[0]])}</td>)}</tr>
                    ))}
                    <tr className="subtotal"><td>N{l.level} · {l.instance}</td>{COLS.map((c) => <td key={c[0]}>{c[2](l.total[c[0]])}</td>)}</tr>
                  </Fragment>
                ))}
                <tr className="total"><td>Total site</td>{COLS.map((c) => <td key={c[0]}>{c[2](d.site[c[0]])}</td>)}</tr>
              </tbody>
            </table>
          </div>

          <h2>Par thème</h2>
          <div className="scroll-x">
            <table className="list grid">
              <thead><tr><th>Thème</th><th>N1</th><th>N2</th><th>N3</th><th>Total ouvertes</th><th>dont en retard</th><th>Ouvertes GCA</th><th>Ouvertes Client</th><th>Soldées sur le mois</th><th>Problèmes du mois</th><th>Écarts</th><th>Conformité</th></tr></thead>
              <tbody>
                {d.byPillar.map((p: any) => (
                  <tr key={p.code}>
                    <td><span className="tag pillar-tag">{p.code}</span> {p.name}</td>
                    {p.perLevel.map((n: number, i: number) => <td key={i}>{n}</td>)}
                    <td>{p.open}</td><td>{p.late}</td><td>{p.gca}</td><td>{p.client}</td><td>{p.closed}</td>
                    <td>{p.problems}</td><td>{p.ecarts}</td><td>{pct(p.conformity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Origine des actions ouvertes</h2>
          <table className="list grid narrow">
            <thead><tr><th>Origine</th><th>N1</th><th>N2</th><th>N3</th><th>Total</th><th>Part</th></tr></thead>
            <tbody>
              {d.origins.map((o: any) => (
                <tr key={o.origin}><td>{o.origin}</td>{o.perLevel.map((n: number, i: number) => <td key={i}>{n}</td>)}<td>{o.total}</td><td>{pct(d.site.open ? o.total / d.site.open : null)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: any; tone?: 'bad' }) {
  return <div className={`kpi ${tone ?? ''}`}><div className="kpi-v">{value}</div><div className="kpi-l">{label}</div></div>;
}
