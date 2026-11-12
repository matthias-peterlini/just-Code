import { EventEmitter } from 'node:events';
import { fmtRef, parseModelRef, type Config, type ModelRef } from '../config.js';
import { createProvider } from '../providers/index.js';
import type { Message } from '../providers/types.js';
import { TOOLS, type PermissionRequest, type ToolContext } from '../tools/index.js';
import { runLoop, type LoopTool } from './loop.js';

export type AgentStatus = 'queued' | 'running' | 'done' | 'error';

export type JustEvent =
  | { type: 'orch:thinking' }
  | { type: 'orch:text'; text: string }
  | { type: 'orch:tool'; name: string; summary: string }
  | { type: 'agent:spawn'; id: string; name: string; task: string; model: string }
  | { type: 'agent:start'; id: string }
  | { type: 'agent:tool'; id: string; name: string; summary: string }
  | { type: 'agent:done'; id: string; result: string }
  | { type: 'agent:error'; id: string; error: string }
  | { type: 'usage'; input: number; output: number };

const ORCH_SYSTEM = (cwd: string) => `You are the ORCHESTRATOR of just-Code, a terminal coding IDE.
Workspace: ${cwd}. OS: ${process.platform}. Date: ${new Date().toISOString().slice(0, 10)}.

Your job: understand the user's request, plan, and DELEGATE work to sub-agents with the spawn_agents tool.
- Split the work into small, independent, well-scoped tasks (e.g. "explore src/auth and summarise how login works",
  "write unit tests for utils/date.ts", "implement function X in file Y").
- Sub-agents run IN PARALLEL and have tools: read_file, list_files, search, write_file, edit_file, run_shell.
  They do NOT see the conversation: give each one complete context (file paths, conventions, exact goal, expected output).
- Avoid giving two parallel agents edits to the same file.
- You may use the tools yourself for quick checks; for anything bigger, delegate.
- After agents report back, verify/integrate (spawn another wave if needed), then reply to the user with a concise summary.
- For simple questions or chit-chat, just answer directly without spawning agents.
Reply in the user's language. Use Markdown sparingly (terminal output).`;

const SUB_SYSTEM = (cwd: string, name: string) => `You are "${name}", a focused sub-agent inside just-Code (terminal coding IDE).
Workspace: ${cwd}. OS: ${process.platform}.
Complete ONLY the task you were given, using your tools. Read before you edit. Keep changes minimal and consistent with the codebase.
When done, reply with a short report: what you did, files touched, anything the orchestrator must know (problems, follow-ups).`;

export interface OrchestratorOptions {
  cwd: string;
  getConfig: () => Config;
  requestPermission: (req: PermissionRequest) => Promise<boolean>;
}

export class Orchestrator extends EventEmitter {
  history: Message[] = [];
  private abort?: AbortController;
  private seq = 0;

  constructor(private o: OrchestratorOptions) {
    super();
  }

  emitEv(e: JustEvent) {
    this.emit('event', e);
  }

  reset() {
    this.history = [];
  }

  interrupt() {
    this.abort?.abort();
  }

  get busy() {
    return !!this.abort && !this.abort.signal.aborted;
  }

  private fileTools(agent: string, signal: AbortSignal, onTool: (name: string, summary: string) => void): LoopTool[] {
    const ctx: ToolContext = { cwd: this.o.cwd, agent, signal, requestPermission: this.o.requestPermission };
    return Object.values(TOOLS).map((t) => ({
      def: t.def,
      summarize: t.summarize,
      run: (args) => {
        onTool(t.def.name, t.summarize(args));
        return t.run(args, ctx);
      },
    }));
  }

  private spawnTool(signal: AbortSignal): LoopTool {
    return {
      def: {
        name: 'spawn_agents',
        description:
          'Launch sub-agents IN PARALLEL, each with a small self-contained task. Returns every agent report. ' +
          'Optionally choose a model per agent as "provider:model" (providers: gemini, groq, openrouter, openai, custom).',
        parameters: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Short role name, e.g. "explorer", "test-writer"' },
                  task: { type: 'string', description: 'Complete, self-contained instructions' },
                  model: { type: 'string', description: 'Optional provider:model override' },
                },
                required: ['name', 'task'],
              },
            },
          },
          required: ['agents'],
        },
      },
      summarize: (a) => `${(a.agents ?? []).length} agents`,
      run: async (a) => {
        const specs = (Array.isArray(a.agents) ? a.agents : []) as { name: string; task: string; model?: string }[];
        if (!specs.length) return 'ERROR: no agents given';
        return JSON.stringify(await this.runAgents(specs, signal), null, 1);
      },
    };
  }

  private async runAgents(specs: { name: string; task: string; model?: string }[], signal: AbortSignal) {
    const cfg = this.o.getConfig();
    const jobs = specs.map((s) => {
      const id = `a${++this.seq}`;
      const ref: ModelRef = (s.model && parseModelRef(s.model)) || cfg.subagent;
      this.emitEv({ type: 'agent:spawn', id, name: s.name || id, task: s.task, model: fmtRef(ref) });
      return { id, spec: s, ref };
    });

    const results: { agent: string; ok: boolean; report: string }[] = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        const { id, spec, ref } = jobs[i];
        this.emitEv({ type: 'agent:start', id });
        try {
          const provider = createProvider(cfg, ref.provider);
          const report = await runLoop({
            provider,
            model: ref.model,
            maxSteps: cfg.maxSteps,
            signal,
            messages: [
              { role: 'system', content: SUB_SYSTEM(this.o.cwd, spec.name) },
              { role: 'user', content: spec.task },
            ],
            tools: this.fileTools(spec.name, signal, (name, summary) => this.emitEv({ type: 'agent:tool', id, name, summary })),
            onUsage: (input, output) => this.emitEv({ type: 'usage', input, output }),
          });
          this.emitEv({ type: 'agent:done', id, result: report });
          results[i] = { agent: spec.name, ok: true, report };
        } catch (e) {
          const msg = (e as Error).message;
          this.emitEv({ type: 'agent:error', id, error: msg });
          results[i] = { agent: spec.name, ok: false, report: `FAILED: ${msg}` };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.maxParallel, jobs.length)) }, worker));
    return results;
  }

  /** Runs one user turn. Returns the orchestrator's final answer. */
  async send(userText: string): Promise<string> {
    const cfg = this.o.getConfig();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    if (!this.history.length) this.history.push({ role: 'system', content: ORCH_SYSTEM(this.o.cwd) });
    this.history.push({ role: 'user', content: userText });
    this.emitEv({ type: 'orch:thinking' });
    try {
      const provider = createProvider(cfg, cfg.orchestrator.provider);
      return await runLoop({
        provider,
        model: cfg.orchestrator.model,
        maxSteps: cfg.maxSteps,
        signal,
        messages: this.history,
        tools: [
          this.spawnTool(signal),
          ...this.fileTools('orchestrator', signal, (name, summary) => this.emitEv({ type: 'orch:tool', name, summary })),
        ],
        onText: (text) => this.emitEv({ type: 'orch:text', text }),
        onToolStart: (call, summary) => {
          if (call.name === 'spawn_agents') this.emitEv({ type: 'orch:tool', name: call.name, summary });
        },
        onUsage: (input, output) => this.emitEv({ type: 'usage', input, output }),
      });
    } catch (e) {
      // Keep history consistent: drop a dangling tool-call turn so the next request is valid.
      const last = this.history[this.history.length - 1];
      if (last?.role === 'assistant' && last.toolCalls?.length) this.history.pop();
      throw e;
    } finally {
      this.abort = undefined;
    }
  }
}
