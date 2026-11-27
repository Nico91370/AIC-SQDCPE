import { useState } from 'react';
import { authHeader } from './auth.ts';

/** Import du classeur Excel AIC SQDCPE (référentiels, journal, plan d'actions). */
export default function ImportExcel({ defaultSite, onDone }: { defaultSite?: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [site, setSite] = useState(defaultSite ?? 'Site pilote');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/import?site=${encodeURIComponent(site.trim())}&replace=${replace ? 1 : 0}`, {
        method: 'POST',
        headers: { Authorization: await authHeader(), 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Erreur ${r.status}`);
      setMsg({ ok: true, text: `Import terminé : ${d.indicators} indicateurs, ${d.measurements} mesures, ${d.actions} actions.` });
      onDone();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-box">
      <label>Fichier Excel (AIC SQDCPE .xlsm ou .xlsx)
        <input type="file" accept=".xlsm,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label>Nom du site
        <input value={site} onChange={(e) => setSite(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Remplacer les données si ce site existe déjà
      </label>
      <button className="btn primary" disabled={!file || !site.trim() || busy} onClick={send}>
        {busy ? 'Import en cours… (jusqu\'à une minute)' : 'Importer'}
      </button>
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
    </div>
  );
}
