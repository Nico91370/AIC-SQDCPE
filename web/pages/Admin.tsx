import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, type Indicator } from '../App.tsx';

const LIST_LABELS: Record<string, string> = {
  typologie: 'Typologie du problème', criticite: 'Criticité', responsabilite: 'Responsabilité',
  origine: 'Origine du problème', priorite: 'Priorité', escalade: "Type d'escalade", suite: 'Suite à donner',
};

export default function Admin() {
  const [tab, setTab] = useState<'ind' | 'svc' | 'lists' | 'users'>('ind');
  return (
    <div className="page">
      <div className="page-head"><h1>Paramètres</h1></div>
      <div className="tabs">
        <button className={tab === 'ind' ? 'on' : ''} onClick={() => setTab('ind')}>Indicateurs</button>
        <button className={tab === 'svc' ? 'on' : ''} onClick={() => setTab('svc')}>Services et animateurs</button>
        <button className={tab === 'lists' ? 'on' : ''} onClick={() => setTab('lists')}>Listes et jours fériés</button>
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Utilisateurs</button>
      </div>
      {tab === 'ind' && <Indicators />}
      {tab === 'svc' && <Services />}
      {tab === 'lists' && <Lists />}
      {tab === 'users' && <Users />}
    </div>
  );
}

function Indicators() {
  const { siteId, config, reload } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const save = async (i: Indicator, patch: Partial<Indicator>) => {
    try {
      await api(`/api/sites/${siteId}/indicators/${i.id}`, { method: 'PATCH', body: patch });
      await reload();
    } catch (e: any) { setErr(e.message); }
  };
  const add = async () => {
    const s = config.services[0];
    await api(`/api/sites/${siteId}/indicators`, { body: { service_id: s.id, pillar: 'S', label: 'Nouvel indicateur', direction: '>=', target: 0 } });
    await reload();
  };
  const del = async (i: Indicator) => {
    if (!confirm(`Supprimer « ${i.label} » ?`)) return;
    try { await api(`/api/sites/${siteId}/indicators/${i.id}`, { method: 'DELETE' }); await reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      {err && <div className="error" onClick={() => setErr(null)}>{err}</div>}
      <p className="muted small">Les modifications sont enregistrées dès que vous quittez la case.</p>
      <div className="scroll-x">
        <table className="list edit">
          <thead><tr><th>Service</th><th>Thème</th><th>Libellé</th><th>Unité</th><th>Sens</th><th>Cible</th><th>Actif</th><th>Graphe</th><th>Cumul</th><th>Axe min</th><th>Axe max</th><th /></tr></thead>
          <tbody>
            {config.indicators.map((i) => (
              <tr key={i.id}>
                <td><select defaultValue={i.service_id} onChange={(e) => save(i, { service_id: Number(e.target.value) })}>
                  {config.services.map((s) => <option key={s.id} value={s.id}>N{s.level} · {s.name}</option>)}</select></td>
                <td><select defaultValue={i.pillar} onChange={(e) => save(i, { pillar: e.target.value })}>
                  {config.pillars.map((p) => <option key={p.code}>{p.code}</option>)}</select></td>
                <td><input defaultValue={i.label} onBlur={(e) => e.target.value !== i.label && save(i, { label: e.target.value })} /></td>
                <td><input className="short" defaultValue={i.unit ?? ''} onBlur={(e) => e.target.value !== (i.unit ?? '') && save(i, { unit: e.target.value })} /></td>
                <td><select defaultValue={i.direction} onChange={(e) => save(i, { direction: e.target.value as any })}><option value=">=">≥</option><option value="<=">≤</option></select></td>
                <td><input className="short" defaultValue={i.target ?? ''} onBlur={(e) => String(i.target ?? '') !== e.target.value && save(i, { target: e.target.value === '' ? null : Number(e.target.value) as any })} /></td>
                <td><input type="checkbox" defaultChecked={i.active} onChange={(e) => save(i, { active: e.target.checked })} /></td>
                <td><input type="checkbox" defaultChecked={i.on_chart} onChange={(e) => save(i, { on_chart: e.target.checked })} /></td>
                <td><select defaultValue={i.aggregation} onChange={(e) => save(i, { aggregation: e.target.value })}><option>Somme</option><option>Moyenne</option><option>Dernier</option></select></td>
                <td><input className="short" defaultValue={i.axis_min ?? ''} onBlur={(e) => save(i, { axis_min: e.target.value === '' ? null : Number(e.target.value) as any })} /></td>
                <td><input className="short" defaultValue={i.axis_max ?? ''} onBlur={(e) => save(i, { axis_max: e.target.value === '' ? null : Number(e.target.value) as any })} /></td>
                <td><button className="btn ghost small" onClick={() => del(i)} title="Supprimer">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" onClick={add}>Ajouter un indicateur</button>
    </>
  );
}

function Services() {
  const { siteId, config, reload } = useApp();
  const save = async (id: number, patch: any) => { await api(`/api/sites/${siteId}/services/${id}`, { method: 'PATCH', body: patch }); await reload(); };
  const [name, setName] = useState('');
  const [level, setLevel] = useState(1);
  return (
    <>
      <table className="list edit narrow">
        <thead><tr><th>Niveau</th><th>Service</th><th>Animateur</th><th>Suppléant</th></tr></thead>
        <tbody>
          {config.services.map((s) => (
            <tr key={s.id}>
              <td>N{s.level}</td>
              <td><input defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && save(s.id, { name: e.target.value })} /></td>
              <td><input list="people-adm" defaultValue={s.animator ?? ''} onBlur={(e) => save(s.id, { animator: e.target.value || null })} /></td>
              <td><input list="people-adm" defaultValue={s.deputy ?? ''} onBlur={(e) => save(s.id, { deputy: e.target.value || null })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="people-adm">{config.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <div className="inline-form">
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>{config.levels.map((l) => <option key={l.level} value={l.level}>N{l.level}</option>)}</select>
        <input placeholder="Nouveau service" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={async () => { await api(`/api/sites/${siteId}/services`, { body: { name: name.trim(), level } }); setName(''); await reload(); }}>Ajouter</button>
      </div>
    </>
  );
}

function Lists() {
  const { siteId, config, reload } = useApp();
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (kind: string, text: string) => {
    await api(`/api/sites/${siteId}/lists/${kind}`, { method: 'PUT', body: { values: text.split('\n') } });
    await reload();
    setSaved(kind);
  };
  return (
    <div className="lists-grid">
      {Object.entries(LIST_LABELS).map(([k, l]) => (
        <label key={k}>{l}{saved === k && <span className="ok-text"> · enregistré</span>}
          <textarea rows={6} defaultValue={(config.lists[k] ?? []).join('\n')} onBlur={(e) => save(k, e.target.value)} />
        </label>
      ))}
      <label>Jours fériés (AAAA-MM-JJ, un par ligne){saved === 'holidays' && <span className="ok-text"> · enregistré</span>}
        <textarea rows={6} defaultValue={config.holidays.join('\n')} onBlur={async (e) => {
          await api(`/api/sites/${siteId}/holidays`, { method: 'PUT', body: { days: e.target.value.split('\n').map((s) => s.trim()) } });
          await reload(); setSaved('holidays');
        }} />
      </label>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const load = () => api('/api/users').then(setUsers);
  useEffect(() => { load(); }, []);
  return (
    <>
      <p className="muted small">Les utilisateurs apparaissent ici après leur première connexion. Animateur : saisit l'AIC et gère les actions. Lecteur : consultation seule. Administrateur : paramètres en plus.</p>
      <table className="list narrow">
        <thead><tr><th>Nom</th><th>Adresse</th><th>Rôle</th><th>Dernière connexion</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td>{u.name}</td><td className="muted">{u.email}</td>
              <td><select value={u.role} onChange={async (e) => { await api(`/api/users/${encodeURIComponent(u.email)}`, { method: 'PATCH', body: { role: e.target.value } }); load(); }}>
                <option value="admin">Administrateur</option><option value="animateur">Animateur</option><option value="lecteur">Lecteur</option>
              </select></td>
              <td className="muted">{u.last_login ? new Date(u.last_login).toLocaleString('fr-FR') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
