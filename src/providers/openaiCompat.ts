import { fetchRetry, ProviderError, type ChatResult, type Message, type Provider, type ToolDef } from './types.js';

/** Any OpenAI-compatible Chat Completions API: Groq, OpenRouter, OpenAI, Ollama, LM Studio, vLLM... */
export class OpenAICompatProvider implements Provider {
  constructor(
    public id: string,
    private baseUrl: string,
    private apiKey: string | undefined,
    private requireKey = true,
  ) {}

  async chat(model: string, messages: Message[], tools: ToolDef[], signal?: AbortSignal): Promise<ChatResult> {
    if (this.requireKey && !this.apiKey)
      throw new ProviderError(`${this.id}: missing API key. Use /key ${this.id} <KEY> or set the env variable.`);

    const msgs = messages.map((m) => {
      switch (m.role) {
        case 'assistant':
          return {
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  })),
                }
              : {}),
          };
        case 'tool':
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        default:
          return { role: m.role, content: m.content };
      }
    });

    const body: Record<string, unknown> = { model, messages: msgs, temperature: 0.4 };
    if (tools.length) {
      body.tools = tools.map((t) => ({ type: 'function', function: t }));
      body.tool_choice = 'auto';
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/just-code';
      headers['X-Title'] = 'just-Code';
    }

    const res = await fetchRetry(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ProviderError(`${this.id} ${res.status}: ${json?.error?.message ?? res.statusText}`, res.status);

    const msg = json.choices?.[0]?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((tc: any, i: number) => {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = { _raw: tc.function?.arguments };
      }
      return { id: tc.id ?? `call_${Date.now()}_${i}`, name: tc.function?.name, args };
    });
    return {
      text: typeof msg.content === 'string' ? msg.content : '',
      toolCalls,
      usage: json.usage ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 } : undefined,
    };
  }
}
