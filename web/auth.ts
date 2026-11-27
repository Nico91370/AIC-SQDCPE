import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

// Connexion : Microsoft 365 (Entra ID) en production, nom saisi en mode test.
export type AuthConfig = { mode: 'dev' } | { mode: 'entra'; tenantId: string; clientId: string };

let config: AuthConfig = { mode: 'dev' };
let msal: PublicClientApplication | null = null;
let account: AccountInfo | null = null;
const DEV_KEY = 'aic.devUser';

export async function initAuth(): Promise<AuthConfig> {
  config = await (await fetch('/api/auth-config')).json();
  if (config.mode === 'entra') {
    msal = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    await msal.initialize();
    const res = await msal.handleRedirectPromise();
    account = res?.account ?? msal.getAllAccounts()[0] ?? null;
  }
  return config;
}

export function isSignedIn(): boolean {
  if (config.mode === 'entra') return !!account;
  try { return !!localStorage.getItem(DEV_KEY); } catch { return false; }
}

export async function signIn(devName?: string) {
  if (config.mode === 'entra') {
    await msal!.loginRedirect({ scopes: ['openid', 'profile', 'email'] });
    return;
  }
  try { localStorage.setItem(DEV_KEY, devName ?? ''); } catch { /* stockage indisponible */ }
}

export async function signOut() {
  if (config.mode === 'entra') {
    await msal!.logoutRedirect({ account: account ?? undefined });
    return;
  }
  try { localStorage.removeItem(DEV_KEY); } catch { /* ignore */ }
  window.location.reload();
}

export async function authHeader(): Promise<string> {
  if (config.mode === 'entra') {
    if (!account) return '';
    try {
      const r = await msal!.acquireTokenSilent({ account, scopes: ['openid', 'profile', 'email'] });
      return 'Bearer ' + r.idToken;
    } catch {
      await msal!.acquireTokenRedirect({ account, scopes: ['openid', 'profile', 'email'] });
      return '';
    }
  }
  let name = '';
  try { name = localStorage.getItem(DEV_KEY) ?? ''; } catch { /* ignore */ }
  return name ? 'Dev ' + encodeURIComponent(name) : '';
}

export const currentAuthMode = () => config.mode;
