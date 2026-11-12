import { googleOAuth, providerSettings, type Config, type ProviderId } from '../config.js';
import { GeminiProvider } from './gemini.js';
import { OpenAICompatProvider } from './openaiCompat.js';
import type { Provider } from './types.js';

export function createProvider(cfg: Config, id: ProviderId): Provider {
  const s = providerSettings(cfg, id);
  if (id === 'gemini') return new GeminiProvider(s.baseUrl, s.apiKey, googleOAuth(cfg));
  return new OpenAICompatProvider(id, s.baseUrl, s.apiKey, id !== 'custom');
}

export * from './types.js';
