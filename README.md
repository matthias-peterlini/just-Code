<p align="center"><img src="assets/logo.svg" width="96" alt="just-Code"></p>

# just-Code

IDE di codice AI **nel terminale**: un modello *orchestratore* (es. Gemini) capisce la richiesta, la divide in piccoli compiti e lancia **sub-agenti in parallelo** che leggono, scrivono e modificano i file ed eseguono comandi. L'orchestratore raccoglie i report, verifica e risponde.

Provider supportati: **Google Gemini** (login con account Google oppure API key), **Groq**, **OpenRouter**, **OpenAI** e **qualsiasi API compatibile OpenAI** (Ollama, LM Studio, vLLM…).

```
❯ aggiungi i test per utils/date.ts e aggiorna il README

╭──────────────────────────────────────────────────────────────╮
│ ⠹ orchestrator gemini:gemini-2.5-pro  delegating to 3 agents… │
│   sub-agents ████████░░░░░░░░ 1/3                             │
│   ├─ ✔ explorer    gemini:gemini-2.5-flash · 4.1s · 5 tools   │
│   ├─ ⠼ test-writer groq:llama-3.3-70b · 6.0s  write_file …     │
│   └─ ⠦ docs        gemini:gemini-2.5-flash  edit_file README   │
╰──────────────────────────────────────────────────────────────╯
```

## Installazione

Funziona su **macOS, Linux e Windows** con Node.js 20 o successivo.

```bash
npm install -g @justapps/just-code
just-code            # oppure: jc
```

In alternativa:
- macOS e Linux: `curl -fsSL https://code.justapps.it/install.sh | sh`
- Windows (PowerShell): `irm https://code.justapps.it/install.ps1 | iex`
- Ultima release da GitHub: `npm install -g https://code.justapps.it/latest.tgz`

I comandi degli agenti girano con la tua shell su macOS e Linux, con `cmd.exe` su Windows. In Git Bash su Windows avvia con `winpty just-code`.

Da sorgente: `npm install && npm run build && npm link`.

## Release

Ad ogni push GitHub Actions esegue i test su Linux, macOS e Windows (Node 20 e 22). Se la versione in `package.json` non è ancora pubblicata, crea la release su GitHub e pubblica su npm con **Trusted Publishing** (OIDC, senza token). Per una nuova release basta aumentare `version` in `package.json` e fare push.

## Accesso a Gemini

**Il modo più semplice (gratis):** crea una chiave su [Google AI Studio](https://aistudio.google.com/apikey) — senza attivare la fatturazione hai il livello gratuito — e in just-Code scrivi `/key gemini <KEY>` (oppure `export GEMINI_API_KEY=...`). Se c'è una chiave, ha la precedenza sul login.

**Con il login Google:** `/login <id-progetto>` apre il browser, accedi con il tuo account e il token viene salvato in `~/.just-code/google-auth.json` (si rinnova da solo). L'uso viene addebitato al **tuo** progetto Google Cloud (con la *Generative Language API* abilitata), mai a quello di just-Code. Puoi cambiarlo con `/project <id-progetto>` o `GOOGLE_CLOUD_QUOTA_PROJECT`.

Per usare un tuo client OAuth (tipo **Desktop app**): `/google-client ~/Downloads/client_secret_xxx.json` oppure `/google-client <CLIENT_ID> <CLIENT_SECRET>`.

## Altri provider

| Provider   | Chiave                                       | Esempio modello                       |
|------------|----------------------------------------------|---------------------------------------|
| groq       | `GROQ_API_KEY` o `/key groq …`               | `groq:llama-3.3-70b-versatile`        |
| openrouter | `OPENROUTER_API_KEY` o `/key openrouter …`   | `openrouter:deepseek/deepseek-chat`   |
| openai     | `OPENAI_API_KEY` o `/key openai …`           | `openai:gpt-4.1-mini`                 |
| custom     | `/baseurl custom http://localhost:11434/v1`  | `custom:llama3.1`                     |

Scegli i modelli:

```
/model orchestrator gemini:gemini-2.5-pro
/model sub groq:llama-3.3-70b-versatile
```

L'orchestratore può anche scegliere un modello diverso per ogni singolo sub-agente (campo `model` di `spawn_agents`).

## Permessi e ⚡ TURBO

Di default, prima di **scrivere o modificare file** e di **eseguire comandi shell**, just-Code chiede conferma:
`[y]` sì · `[a]` sempre per questo tool · `[n]` no · `[t]` **TURBO**.

**TURBO** (`/turbo`, il tasto `t` in un prompt, oppure `just-code --turbo`) fa agire gli agenti senza chiedere conferma, e si attiva con un'animazione arcobaleno. `/turbo` lo spegne.
Gli agenti possono lavorare solo dentro la cartella in cui hai avviato just-Code.

## Comandi

| Comando | |
|---|---|
| `/help` | elenco comandi (Tab completa) |
| `/login [progetto]`, `/logout` | account Google per Gemini |
| `/project <id>` | progetto Google Cloud usato con il login |
| `/google-client <id> <secret> [project]` | client OAuth |
| `/key <provider> <key>` | salva una API key |
| `/baseurl <provider> <url>` | endpoint compatibile OpenAI |
| `/model <orchestrator\|sub> <provider:model>` | cambia modello |
| `/models` | modelli suggeriti |
| `/parallel <n>` | numero massimo di sub-agenti in parallelo |
| `/turbo` | attiva o disattiva TURBO |
| `/status`, `/clear`, `/exit` | |

Tasti: `Esc` interrompe il lavoro in corso, `Ctrl+C` due volte esce.

Opzioni da riga di comando: `just-code --turbo --orchestrator gemini:gemini-2.5-pro --sub groq:llama-3.3-70b-versatile --parallel 6 "prompt iniziale"`

La configurazione sta in `~/.just-code/config.json` (puoi cambiare la cartella con `JUST_CODE_HOME`).

## Architettura

```
src/
  cli.tsx                 entry point e argomenti
  config.ts               configurazione, provider, chiavi
  auth/google.ts          login OAuth Google (loopback + PKCE, refresh token)
  providers/              gemini.ts (API nativa) · openaiCompat.ts (Groq/OpenRouter/OpenAI/custom)
  agents/loop.ts          ciclo agente con tool-calling (tool eseguiti in parallelo)
  agents/orchestrator.ts  orchestratore + tool spawn_agents (pool parallelo di sub-agenti)
  tools/                  read_file, list_files, search, write_file, edit_file, run_shell
  ui/                     Ink: logo animato, pannello agenti, permessi, animazione TURBO
```

Ispirato all'esperienza d'uso di [Claude Code](https://github.com/anthropics/claude-code).
