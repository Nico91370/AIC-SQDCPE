import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.ts';
import { codeRequired, currentAuthMode, isSignedIn, signIn, signOut } from './auth.ts';
import ImportExcel from './ImportExcel.tsx';
import Home from './pages/Home.tsx';
import Aic from './pages/Aic.tsx';
import Actions from './pages/Actions.tsx';
import Pilotage from './pages/Pilotage.tsx';
import Admin from './pages/Admin.tsx';

export interface Service { id: number; name: string; level: number; ord: number; animator: string | null; deputy: string | null }
export interface Indicator {
  id: number; service_id: number; pillar: string; label: string; unit: string | null; target: number | null;
  direction: '>=' | '<='; active: boolean; on_chart: boolean; aggregation: string;
  axis_min: number | null; axis_max: number | null; axis_step: number | null; ord: number;
}
export interface Config {
  pillars: { code: string; name: string }[];
  statuses: string[];
  levels: { level: number; instance: string }[];
  services: Service[];
  indicators: Indicator[];
  lists: Record<string, string[]>;
  people: { id: number; name: string; function: string | null; service: string | null }[];
  holidays: string[];
}
export interface User { email: string; name: string; role: 'admin' | 'animateur' | 'lecteur' }

interface Ctx { siteId: number; config: Config; user: User; reload: () => Promise<void>; canWrite: boolean }
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

function Login({ rejected }: { rejected?: boolean }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const needCode = codeRequired();
  const entra = currentAuthMode() === 'entra';
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-big">AIC <span>·</span> SQDCPE</div>
        <p>Animation à intervalle court : Sécurité, Qualité, Délais, Coûts, Personnel, Environnement.</p>
        {entra ? (
          <button className="btn primary" onClick={() => signIn()}>Se connecter avec Microsoft 365</button>
        ) : (
          <form onSubmit={async (e) => { e.preventDefault(); await signIn(needCode ? `${code.trim()}:${name.trim()}` : name.trim()); window.location.reload(); }}>
            <label>Votre nom
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" autoFocus />
            </label>
            {needCode && (
              <label>Code d'accès
                <input type="password" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
            )}
            {rejected && <div className="error">Code d'accès incorrect.</div>}
            <button className="btn primary" disabled={!name.trim() || (needCode && !code.trim())}>Entrer</button>
            <p className="hint">Mode test : la connexion Microsoft 365 s'active à l'installation sur le serveur.</p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(isSignedIn());
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const [siteId, setSiteId] = useState<number | null>(() => {
    try { return Number(localStorage.getItem('aic.site')) || null; } catch { return null; }
  });
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!authed) return;
    Promise.all([api('/api/me'), api('/api/sites')])
      .then(([me, s]) => {
        setUser(me);
        setSites(s);
        if (!s.some((x: any) => x.id === siteId)) setSiteId(s[0]?.id ?? null);
      })
      .catch((e) => {
        if (e.status !== 401) return setError(e.message);
        try { localStorage.removeItem('aic.devUser'); } catch { /* ignore */ }
        setRejected(true);
        setAuthed(false);
      });
  }, [authed]);

  const reload = useCallback(async () => {
    if (!siteId) return;
    setConfig(await api(`/api/sites/${siteId}/config`));
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    try { localStorage.setItem('aic.site', String(siteId)); } catch { /* ignore */ }
    setConfig(null);
    reload().catch((e) => setError(e.message));
  }, [siteId, reload]);

  if (!authed) return <Login rejected={rejected} />;
  if (error) return <div className="fatal">{error}</div>;
  if (user && sites.length === 0) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand-big">AIC <span>·</span> SQDCPE</div>
          {user.role === 'admin' ? (
            <>
              <p>Bienvenue {user.name}. Pour commencer, importez votre fichier Excel AIC SQDCPE : indicateurs, équipe, journal des mesures et plan d'actions seront repris.</p>
              <ImportExcel onDone={() => window.location.reload()} />
            </>
          ) : <p>Aucun site n'est encore configuré. Un administrateur doit d'abord importer le fichier Excel.</p>}
        </div>
      </div>
    );
  }
  if (!user || !siteId || !config) return <div className="loading">Chargement…</div>;

  const canWrite = user.role !== 'lecteur';
  return (
    <AppCtx.Provider value={{ siteId, config, user, reload, canWrite }}>
      <header className="topbar">
        <div className="brand">AIC <span>·</span> SQDCPE</div>
        <nav>
          <NavLink to="/" end>Accueil</NavLink>
          <NavLink to="/aic">Écran d'AIC</NavLink>
          <NavLink to="/actions">Plan d'actions</NavLink>
          <NavLink to="/pilotage">Pilotage</NavLink>
          {user.role === 'admin' && <NavLink to="/admin">Paramètres</NavLink>}
        </nav>
        <div className="topbar-right">
          {sites.length > 1 ? (
            <select value={siteId} onChange={(e) => setSiteId(Number(e.target.value))} aria-label="Site">
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : <span className="site-name">{sites[0]?.name}</span>}
          <span className="user" title={user.email}>{user.name}</span>
          <button className="btn ghost small" onClick={() => signOut()}>Déconnexion</button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/aic" element={<Aic />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/pilotage" element={<Pilotage />} />
          <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </AppCtx.Provider>
  );
}
