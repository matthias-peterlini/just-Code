import type { Message, Provider, ToolDef, ToolCall } from '../providers/types.js';

export interface LoopTool {
  def: ToolDef;
  summarize: (args: Record<string, any>) => string;
  run: (args: Record<string, any>) => Promise<string>;
}

export interface LoopOptions {
  provider: Provider;
  model: string;
  messages: Message[];
  tools: LoopTool[];
  maxSteps: number;
  signal?: AbortSignal;
  onToolStart?: (call: ToolCall, summary: string) => void;
  onToolEnd?: (call: ToolCall, result: string) => void;
  onText?: (text: string) => void;
  onUsage?: (input: number, output: number) => void;
}

/** Generic tool-calling agent loop. Mutates `messages` (history) and returns the final text. */
export async function runLoop(o: LoopOptions): Promise<string> {
  const byName = new Map(o.tools.map((t) => [t.def.name, t]));
  const defs = o.tools.map((t) => t.def);
  for (let step = 0; step < o.maxSteps; step++) {
    if (o.signal?.aborted) throw new Error('Interrupted');
    const res = await o.provider.chat(o.model, o.messages, defs, o.signal);
    if (res.usage) o.onUsage?.(res.usage.input, res.usage.output);
    o.messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls.length ? res.toolCalls : undefined });
    if (!res.toolCalls.length) return res.text;
    if (res.text.trim()) o.onText?.(res.text);

    // Run tool calls of one turn concurrently (spawn_agents benefits most).
    const results = await Promise.all(
      res.toolCalls.map(async (call) => {
        const tool = byName.get(call.name);
        if (!tool) return `ERROR: unknown tool ${call.name}`;
        let summary = '';
        try {
          summary = tool.summarize(call.args);
        } catch {
          /* ignore */
        }
        o.onToolStart?.(call, summary);
        let out: string;
        try {
          out = await tool.run(call.args);
        } catch (e) {
          out = `ERROR: ${(e as Error).message}`;
        }
        o.onToolEnd?.(call, out);
        return out;
      }),
    );
    res.toolCalls.forEach((call, i) => o.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: results[i] }));
  }
  return '(stopped: max steps reached)';
}
