import { useEffect, useState } from 'react';
import { api, fmtDate } from './api.ts';
import { useApp } from './App.tsx';

export interface ActionRow {
  id: number; ref: string; num: number; created_on: string; requested_by: string | null;
  service_id: number | null; service_name?: string | null; level: number; emitter_level: number;
  pillar: string | null; responsibility: string | null; origin: string | null; indicator_id: number | null;
  indicator_label?: string | null; measurement_id: number | null; typology: string | null; criticality: string | null;
  subject: string; cause: string | null; action: string | null; owner: string | null; priority: string | null;
  due_date: string | null; status: string; pdca: string; done_date: string | null; outcome: string | null;
  escalation_reason: string | null; escalation_answer: string | null; state: string;
  history?: { at: string; author: string | null; text: string }[];
}

export type Draft = Partial<ActionRow>;

/** Fiche problème / action (ex-onglet Fiche). */
export default function ActionForm({ initial, onClose, onSaved, title, extraButtons }: {
  initial: Draft;
  onClose: () => void;
  onSaved: (a: ActionRow) => void;
  title?: string;
  extraButtons?: React.ReactNode;
}) {
  const { siteId, config, canWrite } = useApp();
  const [a, setA] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isNew = !initial.id;

  useEffect(() => {
    setA(initial);
    if (initial.id) api(`/api/sites/${siteId}/actions/${initial.id}`).then(setA).catch(() => {});
  }, [initial.id, initial.measurement_id]);

  const set = (k: keyof ActionRow, v: any) => setA((x) => ({ ...x, [k]: v === '' ? null : v }));
  const lists = config.lists;
  const indicators = config.indicators.filter((i) => !a.service_id || i.service_id === a.service_id);

  async function save() {
    if (!a.subject?.trim()) { setErr('Décrivez le problème.'); return; }
    if (!a.owner?.trim()) { setErr('Le porteur est obligatoire.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const body: any = { ...a };
      delete body.history; delete body.ref; delete body.state; delete body.service_name; delete body.indicator_label;
      const saved = isNew
        ? await api<ActionRow>(`/api/sites/${siteId}/actions`, { body })
        : await api<ActionRow>(`/api/sites/${siteId}/actions/${a.id}`, { method: 'PATCH', body });
      onSaved(saved);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const sel = (k: keyof ActionRow, opts: (string | { v: any; l: string })[], allowEmpty = true) => (
    <select value={(a[k] as any) ?? ''} onChange={(e) => set(k, e.target.value)} disabled={!canWrite}>
      {allowEmpty && <option value="">—</option>}
      {opts.map((o) => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={String(o.v)} value={o.v}>{o.l}</option>)}
    </select>
  );

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Fiche problème / action">
        <div className="modal-head">
          <h2>{title ?? (isNew ? 'Nouveau problème / action' : `Problème / action ${a.ref ?? ''}`)}</h2>
          {!isNew && <span className={`state-pill st-${slug(a.state)}`}>{a.state}</span>}
          <button className="btn ghost small" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="form-grid">
          <label className="span2">Problème
            <textarea rows={2} value={a.subject ?? ''} onChange={(e) => set('subject', e.target.value)} disabled={!canWrite} />
          </label>
          <label>Niveau
            {sel('level', config.levels.map((l) => ({ v: l.level, l: `N${l.level} · ${l.instance}` })), false)}
          </label>
          <label>Service
            {sel('service_id', config.services.map((s) => ({ v: s.id, l: `${s.name} (N${s.level})` })))}
          </label>
          <label>Thème SQDCPE
            {sel('pillar', config.pillars.map((p) => ({ v: p.code, l: `${p.code} · ${p.name}` })))}
          </label>
          <label>Indicateur
            {sel('indicator_id', indicators.map((i) => ({ v: i.id, l: i.label })))}
          </label>
          <label>Origine{sel('origin', lists.origine ?? [])}</label>
          <label>Typologie{sel('typology', lists.typologie ?? [])}</label>
          <label>Criticité{sel('criticality', lists.criticite ?? [])}</label>
          <label>Responsabilité (GCA / Client){sel('responsibility', lists.responsabilite ?? [])}</label>
          <label className="span2">Cause
            <textarea rows={2} value={a.cause ?? ''} onChange={(e) => set('cause', e.target.value)} disabled={!canWrite} />
          </label>
          <label className="span2">Solution / action décidée
            <textarea rows={2} value={a.action ?? ''} onChange={(e) => set('action', e.target.value)} disabled={!canWrite} />
          </label>
          <label>Auteur
            <input value={a.requested_by ?? ''} onChange={(e) => set('requested_by', e.target.value)} disabled={!canWrite} />
          </label>
          <label>Porteur (obligatoire)
            <input list="people" value={a.owner ?? ''} onChange={(e) => set('owner', e.target.value)} disabled={!canWrite} />
            <datalist id="people">{config.people.map((p) => <option key={p.id} value={p.name}>{p.function}</option>)}</datalist>
          </label>
          <label>Date de fin prévue
            <input type="date" value={a.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} disabled={!canWrite} />
          </label>
          <label>Priorité{sel('priority', lists.priorite ?? [])}</label>
          <label>Statut{sel('status', config.statuses, false)}</label>
          <label>PDCA{sel('pdca', ['P', 'D', 'C', 'A'], false)}</label>
          {(a.status === 'Soldée' || a.status === 'Abandonnée') && (
            <>
              <label>Date de fin réelle
                <input type="date" value={a.done_date ?? ''} onChange={(e) => set('done_date', e.target.value)} disabled={!canWrite} />
              </label>
              <label>Finalité / résultat
                <input value={a.outcome ?? ''} onChange={(e) => set('outcome', e.target.value)} disabled={!canWrite} />
              </label>
            </>
          )}
          <label className="span2">Raison de l'escalade
            <input value={a.escalation_reason ?? ''} onChange={(e) => set('escalation_reason', e.target.value)} disabled={!canWrite} />
          </label>
          <label className="span2">Réponse à l'escalade (niveau supérieur)
            <input value={a.escalation_answer ?? ''} onChange={(e) => set('escalation_answer', e.target.value)} disabled={!canWrite} />
          </label>
        </div>
        {!isNew && (
          <p className="muted small">
            Créée le {fmtDate(a.created_on)} en N{a.emitter_level} · niveau actuel N{a.level}
            {a.done_date ? ` · fin réelle ${fmtDate(a.done_date)}` : ''}
          </p>
        )}
        {a.history && a.history.length > 0 && (
          <details className="history">
            <summary>Historique du suivi ({a.history.length})</summary>
            <ul>
              {a.history.map((h, i) => (
                <li key={i}><span className="muted">{new Date(h.at).toLocaleDateString('fr-FR')} · {h.author}</span> {h.text}</li>
              ))}
            </ul>
          </details>
        )}
        {err && <div className="error">{err}</div>}
        <div className="modal-foot">
          {extraButtons}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Annuler</button>
          {canWrite && <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>}
        </div>
      </div>
    </div>
  );
}

export const slug = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '-');

/** Boutons rapides : statut, PDCA, escalade. */
export function QuickSteps({ a, onChange }: { a: ActionRow; onChange: (a: ActionRow) => void }) {
  const { siteId, canWrite, config } = useApp();
  if (!canWrite) return null;
  const max = config.levels.length;
  async function step(what: 'status' | 'pdca' | 'up' | 'down') {
    const body: any = { what };
    if (what === 'up') {
      const r = window.prompt(`Escalader ${a.ref} en N${a.level + 1} : raison de l'escalade ?`);
      if (r === null) return;
      body.reason = r;
    }
    if (what === 'status' && a.status === 'En cours' && !a.outcome) {
      const r = window.prompt(`Action soldée : ${a.action ?? a.subject}\nQuel résultat cette action a-t-elle produit ?`);
      if (r === null) return;
      body.outcome = r;
    }
    try {
      onChange(await api(`/api/sites/${siteId}/actions/${a.id}/step`, { body }));
    } catch (e: any) {
      alert(e.message);
    }
  }
  const nextLabel = a.status === 'À faire' ? 'Démarrer' : a.status === 'En cours' ? 'Solder' : 'Rouvrir';
  return (
    <span className="quick">
      <button className="btn small" onClick={() => step('status')} title="Faire avancer le statut">{nextLabel}</button>
      <button className="btn small pdca" onClick={() => step('pdca')} title="Faire avancer le PDCA">{a.pdca}</button>
      <button className="btn small" disabled={a.level >= max} onClick={() => step('up')} title="Escalader au niveau supérieur">▲</button>
      <button className="btn small" disabled={a.level <= 1} onClick={() => step('down')} title="Redescendre au niveau inférieur">▼</button>
    </span>
  );
}
