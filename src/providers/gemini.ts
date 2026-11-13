import { getGoogleAccessToken } from '../auth/google.js';
import type { GoogleOAuthSettings } from '../config.js';
import { fetchRetry, ProviderError, type ChatResult, type JSONSchema, type Message, type Provider, type ToolCall, type ToolDef } from './types.js';

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}

/** Gemini accepts an OpenAPI subset: uppercase-insensitive types, no additionalProperties. */
function toGeminiSchema(s: JSONSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.required?.length) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  return out;
}

export const NOT_CONNECTED =
  'Gemini is not connected. Easiest (free): get a key at https://aistudio.google.com/apikey and run /key gemini <KEY>. ' +
  'Or sign in with /login <your-google-cloud-project-id>.';
export const NEED_PROJECT =
  'Logged in with Google, but no Google Cloud project is set for usage. Run /project <your-project-id> ' +
  '(a project of yours with the "Generative Language API" enabled) — or use a free AI Studio key: /key gemini <KEY>.';

export class GeminiProvider implements Provider {
  id = 'gemini';
  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
    private oauth: GoogleOAuthSettings,
  ) {}

  private async authHeaders(): Promise<Record<string, string>> {
    // An API key (free tier from Google AI Studio) wins: it is billed to the user's own key.
    if (this.apiKey) return { 'x-goog-api-key': this.apiKey };
    const token = await getGoogleAccessToken(this.oauth).catch(() => null);
    if (token) {
      // With a Google login, usage must be billed to the user's own Google Cloud project,
      // never to the project that owns the OAuth client.
      if (!this.oauth.quotaProject) throw new ProviderError(NEED_PROJECT);
      return { Authorization: `Bearer ${token}`, 'x-goog-user-project': this.oauth.quotaProject };
    }
    throw new ProviderError(NOT_CONNECTED);
  }

  async chat(model: string, messages: Message[], tools: ToolDef[], signal?: AbortSignal): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents: { role: 'user' | 'model'; parts: Part[] }[] = [];
    const push = (role: 'user' | 'model', parts: Part[]) => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts });
    };
    for (const m of messages) {
      if (m.role === 'user') push('user', [{ text: m.content }]);
      else if (m.role === 'assistant') {
        const parts: Part[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls ?? []) {
          const p: Part = { functionCall: { name: tc.name, args: tc.args } };
          if (tc.meta?.thoughtSignature) p.thoughtSignature = String(tc.meta.thoughtSignature);
          parts.push(p);
        }
        if (parts.length) push('model', parts);
      } else if (m.role === 'tool') {
        push('user', [{ functionResponse: { name: m.name, response: { result: m.content } } }]);
      }
    }

    const body: Record<string, unknown> = { contents, generationConfig: { temperature: 0.4 } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools.length)
      body.tools = [
        { functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) },
      ];

    const res = await fetchRetry(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) }, body: JSON.stringify(body) },
      signal,
    );
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ProviderError(`Gemini ${res.status}: ${json?.error?.message ?? res.statusText}`, res.status);

    const cand = json.candidates?.[0];
    const parts: Part[] = cand?.content?.parts ?? [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    parts.forEach((p, i) => {
      if (p.text && !p.thought) text += p.text;
      if (p.functionCall)
        toolCalls.push({
          id: p.functionCall.id ?? `call_${Date.now()}_${i}`,
          name: p.functionCall.name,
          args: p.functionCall.args ?? {},
          meta: p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : undefined,
        });
    });
    if (!text && !toolCalls.length && cand?.finishReason && cand.finishReason !== 'STOP')
      text = `(Gemini stopped: ${cand.finishReason})`;
    const u = json.usageMetadata;
    return { text, toolCalls, usage: u ? { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 } : undefined };
  }
}
