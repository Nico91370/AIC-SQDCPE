import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api.ts';
import { useApp } from '../App.tsx';
import ActionForm, { QuickSteps, slug, type ActionRow, type Draft } from '../ActionForm.tsx';

const STATES = ['En retard', 'Échéance proche', 'À faire', 'En cours', 'Sans échéance', 'Soldée', 'Abandonnée'];

export default function Actions() {
  const { siteId, config, user, canWrite } = useApp();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ActionRow[] | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  const f = Object.fromEntries(params.entries());
  const open = f.open ?? '1';

  const setF = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };

  async function load() {
    const qs = new URLSearchParams({ ...f, open: open === '1' ? '1' : '' });
    setRows(await api(`/api/sites/${siteId}/actions?${qs}`));
  }
  useEffect(() => { load(); }, [siteId, params.toString()]);

  function exportCsv() {
    if (!rows) return;
    const cols: [string, (a: ActionRow) => unknown][] = [
      ['Réf', (a) => a.ref], ['Créée le', (a) => fmtDate(a.created_on)], ['Service', (a) => a.service_name],
      ['Niveau', (a) => `N${a.level}`], ['Niveau émetteur', (a) => `N${a.emitter_level}`], ['Thème', (a) => a.pillar],
      ['Responsabilité', (a) => a.responsibility], ['Origine', (a) => a.origin], ['Indicateur', (a) => a.indicator_label],
      ['Typologie', (a) => a.typology], ['Criticité', (a) => a.criticality], ['Problème', (a) => a.subject],
      ['Cause', (a) => a.cause], ['Action', (a) => a.action], ['Pilote', (a) => a.owner], ['Priorité', (a) => a.priority],
      ['Échéance', (a) => fmtDate(a.due_date)], ['Statut', (a) => a.status], ['PDCA', (a) => a.pdca],
      ['Fin réelle', (a) => fmtDate(a.done_date)], ['Finalité', (a) => a.outcome], ['État', (a) => a.state],
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c[0])).join(';'), ...rows.map((a) => cols.map((c) => esc(c[1](a))).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `plan-actions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Plan d'actions</h1>
        <span className="grow" />
        <button className="btn" onClick={exportCsv}>Exporter (Excel / CSV)</button>
        {canWrite && <button className="btn primary" onClick={() => setForm({ level: Number(f.level ?? 1), service_id: f.service ? Number(f.service) : undefined, requested_by: user.name, status: 'À faire', pdca: 'P' })}>Nouvelle action</button>}
      </div>
      <div className="filters">
        <select value={f.level ?? ''} onChange={(e) => setF('level', e.target.value)} aria-label="Niveau">
          <option value="">Tous niveaux</option>
          {config.levels.map((l) => <option key={l.level} value={l.level}>N{l.level} · {l.instance}</option>)}
        </select>
        <select value={f.service ?? ''} onChange={(e) => setF('service', e.target.value)} aria-label="Service">
          <option value="">Tous services</option>
          {config.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={f.pillar ?? ''} onChange={(e) => setF('pillar', e.target.value)} aria-label="Thème">
          <option value="">Tous thèmes</option>
          {config.pillars.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
        </select>
        <select value={f.state ?? ''} onChange={(e) => setF('state', e.target.value)} aria-label="État">
          <option value="">Tous états</option>
          {STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={open === '1'} onChange={(e) => setF('open', e.target.checked ? '1' : '0')} /> Ouvertes seulement</label>
        <input type="search" placeholder="Rechercher…" defaultValue={f.search ?? ''} onKeyDown={(e) => e.key === 'Enter' && setF('search', (e.target as HTMLInputElement).value)} />
      </div>
      {!rows ? <div className="loading">Chargement…</div> : (
        <table className="list wide">
          <thead>
            <tr><th>Réf</th><th>Créée</th><th>Niv.</th><th>Service</th><th>Thème</th><th>Problème</th><th>Action</th><th>Porteur</th><th>Prio.</th><th>Échéance</th><th>État</th><th /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={12} className="muted">Aucune action</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setForm({ id: a.id })}>
                <td className="nowrap">{a.ref}</td>
                <td className="nowrap">{fmtDate(a.created_on)}</td>
                <td className="nowrap">N{a.level}{a.emitter_level < a.level && <span className="tag up">↑N{a.emitter_level}</span>}</td>
                <td>{a.service_name}</td>
                <td><span className="tag pillar-tag">{a.pillar}</span></td>
                <td>{a.subject}</td>
                <td className="muted">{a.action}</td>
                <td>{a.owner}</td>
                <td>{a.priority}</td>
                <td className="nowrap">{fmtDate(a.due_date)}</td>
                <td><span className={`state-pill st-${slug(a.state)}`}>{a.state}</span></td>
                <td onClick={(e) => e.stopPropagation()}><QuickSteps a={a} onChange={() => load()} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {form && <ActionForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
