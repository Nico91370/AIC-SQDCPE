// Règles métier reprises des macros VBA et des formules du classeur Excel.

export const PILLARS = [
  { code: 'S', name: 'Sécurité' },
  { code: 'Q', name: 'Qualité' },
  { code: 'D', name: 'Délais' },
  { code: 'C', name: 'Coûts' },
  { code: 'P', name: 'Personnel' },
  { code: 'E', name: 'Environnement' },
] as const;
export type PillarCode = (typeof PILLARS)[number]['code'];

export const STATUSES = ['À faire', 'En cours', 'Soldée', 'Abandonnée'] as const;
export type ActionStatus = (typeof STATUSES)[number];
export const CLOSED: ActionStatus[] = ['Soldée', 'Abandonnée'];

export type Direction = '>=' | '<=';

/** OK / NOK d'une mesure face à sa cible (formule Journal!I). */
export function measureStatus(value: number | null, target: number | null, direction: Direction): 'OK' | 'NOK' | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (target === null || target === undefined) return null;
  if (direction === '>=') return value >= target ? 'OK' : 'NOK';
  return value <= target ? 'OK' : 'NOK';
}

/** État affiché d'une action (formule Actions!AC). */
export function actionState(a: { status: string; due_date: string | null }, today: string): string {
  if (a.status === 'Soldée') return 'Soldée';
  if (a.status === 'Abandonnée') return 'Abandonnée';
  if (!a.due_date) return 'Sans échéance';
  if (a.due_date < today) return 'En retard';
  if (a.due_date <= addDays(today, 3)) return 'Échéance proche';
  return a.status === 'En cours' ? 'En cours' : 'À faire';
}

export interface StatusChange {
  status: ActionStatus;
  pdca?: 'P' | 'D' | 'C' | 'A';
  done_date?: string | null;
  trace: string | null;
}

/** Passage à un statut, avec PDCA et date de fin tenus à jour (macro PoserStatut). */
export function applyStatus(
  current: { status: string; pdca: string; done_date: string | null },
  next: ActionStatus,
  today: string,
): StatusChange {
  if (current.status === next) return { status: next, trace: null };
  switch (next) {
    case 'En cours':
      return {
        status: next,
        pdca: current.pdca === 'P' || !current.pdca ? 'D' : (current.pdca as 'D' | 'C' | 'A'),
        done_date: null,
        trace: 'Démarrée',
      };
    case 'Soldée':
      return { status: next, pdca: 'A', done_date: current.done_date ?? today, trace: 'Soldée' };
    case 'Abandonnée':
      return { status: next, done_date: current.done_date ?? today, trace: 'Abandonnée' };
    default: {
      const reopened = CLOSED.includes(current.status as ActionStatus);
      return {
        status: next,
        done_date: null,
        ...(reopened ? { pdca: 'P' as const } : {}),
        trace: reopened ? 'Réouverte' : null,
      };
    }
  }
}

/** Statut suivant au clic (macro AvancerStatut). */
export function nextStatus(s: string): ActionStatus {
  if (s === 'À faire') return 'En cours';
  if (s === 'En cours') return 'Soldée';
  return 'À faire';
}

/** PDCA suivant (macro AvancerPdca). */
export function nextPdca(p: string): 'P' | 'D' | 'C' | 'A' {
  const i = 'PDCA'.indexOf(p);
  return 'PDCA'[(i + 1) % 4] as 'P' | 'D' | 'C' | 'A';
}

/** Date de mesure à partir du jour de l'AIC et du décalage J / J-1 / J-2. */
export function measureDate(aicDate: string, offset: number): string {
  return addDays(aicDate, -Math.abs(offset));
}

/** Agrégation mensuelle d'un indicateur (Somme / Moyenne / Dernier). */
export function aggregate(values: { date: string; value: number }[], how: string): number | null {
  if (values.length === 0) return null;
  if (how === 'Somme') return values.reduce((s, v) => s + v.value, 0);
  if (how === 'Dernier') return [...values].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.value;
  return values.reduce((s, v) => s + v.value, 0) / values.length;
}

/**
 * État d'un pilier pour un jour (Calculs, lignes 11 à 16) :
 * 2 = au moins une mesure NOK (rouge), 1 = mesures toutes OK (vert),
 * 3 = week-end ou jour férié, 0 = rien de mesuré.
 */
export function dayState(statuses: ('OK' | 'NOK' | null)[], date: string, holidays: Set<string>): 0 | 1 | 2 | 3 {
  if (statuses.includes('NOK')) return 2;
  if (statuses.includes('OK')) return 1;
  if (isWeekend(date) || holidays.has(date)) return 3;
  return 0;
}

// ---------------------------------------------------------------- dates ISO
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isWeekend(iso: string): boolean {
  const wd = new Date(iso + 'T00:00:00Z').getUTCDay();
  return wd === 0 || wd === 6;
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function monthBounds(year: number, month: number): { first: string; last: string; days: number } {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first, last: addDays(first, days - 1), days };
}

export function actionRef(num: number): string {
  return 'A-' + String(num).padStart(3, '0');
}
