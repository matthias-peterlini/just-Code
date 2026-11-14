import {
  DEFAULT_BASE_URLS,
  providerSettings,
  type Config,
  type ModelRef,
  type ProviderId,
} from '../config.js';
import { isGoogleLoggedIn } from '../auth/google.js';
import { createProvider } from '../providers/index.js';

/** A ready-made way to connect just-Code to a model provider (used by the guided setup). */
export interface Preset {
  id: string;
  provider: ProviderId;
  label: string;
  hint: string;
  free?: boolean;
  /** Where the user creates the API key. */
  keyUrl?: string;
  /** 'required' | 'optional' | 'none' (Google login). */
  key: 'required' | 'optional' | 'none';
  login?: boolean;
  baseUrl?: boolean;
  orchestrator: string;
  sub: string;
  models: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'gemini-key',
    provider: 'gemini',
    label: 'Google Gemini — free API key',
    hint: 'Recommended. Free tier, no billing needed. Key from Google AI Studio.',
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    key: 'required',
    orchestrator: 'gemini-2.5-flash',
    sub: 'gemini-2.5-flash-lite',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
  {
    id: 'groq',
    provider: 'groq',
    label: 'Groq — free API key',
    hint: 'Very fast open models, free tier. Key from console.groq.com.',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    key: 'required',
    orchestrator: 'openai/gpt-oss-120b',
    sub: 'llama-3.3-70b-versatile',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter',
    provider: 'openrouter',
    label: 'OpenRouter',
    hint: 'Hundreds of models (some free) with one key.',
    keyUrl: 'https://openrouter.ai/keys',
    key: 'required',
    orchestrator: 'google/gemini-2.5-pro',
    sub: 'deepseek/deepseek-chat',
    models: ['google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat', 'openai/gpt-4.1-mini'],
  },
  {
    id: 'openai',
    provider: 'openai',
    label: 'OpenAI',
    hint: 'Paid API key from platform.openai.com.',
    keyUrl: 'https://platform.openai.com/api-keys',
    key: 'required',
    orchestrator: 'gpt-4.1',
    sub: 'gpt-4.1-mini',
    models: ['gpt-4.1', 'gpt-4.1-mini'],
  },
  {
    id: 'gemini-login',
    provider: 'gemini',
    label: 'Google Gemini — sign in with Google',
    hint: 'Uses your own Google Cloud project (Generative Language API enabled).',
    key: 'none',
    login: true,
    orchestrator: 'gemini-2.5-pro',
    sub: 'gemini-2.5-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
  {
    id: 'custom',
    provider: 'custom',
    label: 'Local / custom (Ollama, LM Studio, vLLM…)',
    hint: 'Any OpenAI-compatible endpoint. Default: Ollama on localhost.',
    free: true,
    key: 'optional',
    baseUrl: true,
    orchestrator: 'llama3.1',
    sub: 'llama3.1',
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2'],
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** True when the orchestrator's provider has some usable credential. */
export function hasCredentials(cfg: Config, provider: ProviderId = cfg.orchestrator.provider): boolean {
  if (provider === 'custom') return true;
  if (providerSettings(cfg, provider).apiKey) return true;
  return provider === 'gemini' && isGoogleLoggedIn() && !!(cfg.google.quotaProject ?? process.env.GOOGLE_CLOUD_QUOTA_PROJECT);
}

/** Show the guided setup on first run: never completed and nothing configured yet. */
export function needsSetup(cfg: Config): boolean {
  return !cfg.setupDone && !hasCredentials(cfg);
}

export interface SetupChoice {
  preset: Preset;
  apiKey?: string;
  baseUrl?: string;
  project?: string;
  orchestrator: string;
  sub: string;
  turbo: boolean;
}

/** Applies the setup answers to a config (pure). */
export function applySetup(cfg: Config, c: SetupChoice): Config {
  const p = c.preset.provider;
  const prov = { ...cfg.providers[p] };
  if (c.apiKey) prov.apiKey = c.apiKey;
  if (c.baseUrl) prov.baseUrl = c.baseUrl;
  return {
    ...cfg,
    providers: { ...cfg.providers, [p]: prov },
    google: c.project ? { ...cfg.google, quotaProject: c.project } : cfg.google,
    orchestrator: { provider: p, model: c.orchestrator },
    subagent: { provider: p, model: c.sub },
    turbo: c.turbo,
    setupDone: true,
  };
}

export const defaultBaseUrl = (p: ProviderId) => DEFAULT_BASE_URLS[p];

/** Sends a tiny request to check that a provider + model work. */
export async function testConnection(cfg: Config, ref: ModelRef, timeoutMs = 30_000): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const provider = createProvider(cfg, ref.provider);
    await provider.chat(
      ref.model,
      [
        { role: 'system', content: 'Reply with the single word OK.' },
        { role: 'user', content: 'ping' },
      ],
      [],
      ctrl.signal,
    );
    return { ok: true };
  } catch (e) {
    const msg = ctrl.signal.aborted ? `no answer after ${timeoutMs / 1000}s` : (e as Error).message;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}
