import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG_DIR, type GoogleOAuthSettings } from '../config.js';

/**
 * "Login with Google" for Gemini — OAuth 2.0 for installed apps
 * (loopback redirect + PKCE). Tokens are stored in ~/.just-code/google-auth.json.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever',
];
const AUTH_FILE = path.join(CONFIG_DIR, 'google-auth.json');

interface StoredAuth {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  email?: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function readAuth(): StoredAuth | null {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeAuth(a: StoredAuth) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(a, null, 2), { mode: 0o600 });
}

export function isGoogleLoggedIn(): boolean {
  return !!readAuth();
}

export function googleAccount(): string | undefined {
  return readAuth()?.email;
}

export function googleLogout(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  fs.rmSync(AUTH_FILE);
  return true;
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* user can copy the URL */
  }
}

/**
 * Starts the OAuth flow. `onUrl` receives the consent URL (shown in the UI in case
 * the browser does not open). Resolves with the account email.
 */
export async function googleLogin(
  settings: GoogleOAuthSettings,
  onUrl: (url: string) => void,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!settings.clientId) {
    throw new Error(
      'Missing Google OAuth client ID. Create a "Desktop app" OAuth client in Google Cloud Console ' +
        '(APIs & Services → Credentials), enable the "Generative Language API", then run ' +
        '/google-client <CLIENT_ID> <CLIENT_SECRET> (or set JUST_CODE_GOOGLE_CLIENT_ID / _SECRET).',
    );
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;height:100vh">` +
          `<div style="text-align:center"><h1>${ok ? '✓ just-Code connected' : '✗ Login failed'}</h1>` +
          `<p>${ok ? 'You can close this tab and go back to the terminal.' : String(err ?? 'invalid state')}</p></div></body></html>`,
      );
      server.close();
      if (ok) resolve({ code: u.searchParams.get('code')!, redirectUri });
      else reject(new Error(`Google login failed: ${err ?? 'state mismatch'}`));
    });
    let redirectUri = '';
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const url =
        AUTH_URL +
        '?' +
        new URLSearchParams({
          client_id: settings.clientId!,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: GOOGLE_SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
      onUrl(url);
      openBrowser(url);
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Google login timed out (5 min).'));
    }, 5 * 60_000);
    server.on('close', () => clearTimeout(timeout));
    signal?.addEventListener('abort', () => {
      server.close();
      reject(new Error('Login cancelled.'));
    });
  });

  const body = new URLSearchParams({
    code,
    client_id: settings.clientId,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (settings.clientSecret) body.set('client_secret', settings.clientSecret);
  const tok = await postToken(body);

  let email: string | undefined;
  try {
    const r = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (r.ok) email = ((await r.json()) as { email?: string }).email;
  } catch {
    /* optional */
  }
  writeAuth({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in - 60) * 1000,
    email,
  });
  return email;
}

async function postToken(body: URLSearchParams) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google token error: ${j.error_description ?? j.error ?? r.status}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in ?? 3600 };
}

/** Returns a valid access token, refreshing it if needed. */
export async function getGoogleAccessToken(settings: GoogleOAuthSettings): Promise<string | null> {
  const a = readAuth();
  if (!a) return null;
  if (Date.now() < a.expires_at) return a.access_token;
  if (!a.refresh_token || !settings.clientId) return null;
  const body = new URLSearchParams({
    client_id: settings.clientId,
    refresh_token: a.refresh_token,
    grant_type: 'refresh_token',
  });
  if (settings.clientSecret) body.set('client_secret', settings.clientSecret);
  const tok = await postToken(body);
  writeAuth({ ...a, access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000 });
  return tok.access_token;
}
