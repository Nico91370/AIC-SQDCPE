import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.ts';
import { useApp } from '../App.tsx';

export default function Home() {
  const { siteId, config } = useApp();
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/api/sites/${siteId}/home`).then(setData); }, [siteId]);
  if (!data) return <div className="loading">Chargement…</div>;
  return (
    <div className="home">
      <div className="home-head">
        <h1>Animation à intervalle court</h1>
        <div className="letters-row">
          {config.pillars.map((p) => <span key={p.code} title={p.name}>{p.code}</span>)}
        </div>
        <p className="muted">{fmtDate(data.today)} · Sécurité · Qualité · Délais · Coûts · Personnel · Environnement</p>
      </div>
      <div className="levels">
        {data.levels.map((l: any) => (
          <section key={l.level} className="level-col">
            <h2><span className="tag big">N{l.level}</span> {l.instance}</h2>
            {data.tiles.filter((t: any) => t.level === l.level).map((t: any) => (
              <div key={t.id} className="tile">
                <div className="tile-name">{t.name}</div>
                <div className="tile-stats">
                  <span><b>{t.open}</b> ouvertes</span>
                  <span className={t.late ? 'late' : ''}><b>{t.late}</b> en retard</span>
                  <span><b>{t.closed}</b> soldées</span>
                </div>
                <div className="tile-links">
                  <Link className="btn primary small" to={`/aic?level=${l.level}&service=${t.id}`}>Lancer l'AIC</Link>
                  <Link className="btn small" to={`/actions?level=${l.level}&service=${t.id}`}>Plan d'actions</Link>
                </div>
              </div>
            ))}
            {l.level === 1 && (
              <Link className="btn ghost small" to="/aic?level=1&service=all">AIC tous services N1</Link>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
