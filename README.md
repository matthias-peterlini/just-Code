<p align="center"><img src="assets/logo.svg" width="96" alt="just-Code"></p>

# just-Code

IDE di codice AI **nel terminale** e con **interfaccia grafica**: un modello *orchestratore* (es. Gemini) capisce la richiesta, la divide in piccoli compiti e lancia **sub-agenti in parallelo** che leggono, scrivono e modificano i file ed eseguono comandi. L'orchestratore raccoglie i report, verifica e risponde.

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

## Primo avvio: configurazione guidata

Al primo avvio just-Code ti guida in 5 passi:
1. scegli il provider (Gemini con chiave gratuita, Groq, OpenRouter, OpenAI, login Google, Ollama/locale);
2. inserisci la chiave (si apre la pagina dove crearla) o fai il login;
3. just-Code prova la connessione;
4. scegli i modelli per orchestratore e sub-agenti;
5. scegli se chiedere conferma o andare in TURBO.

Puoi rifarla quando vuoi con `/setup` oppure `just-code setup`.

## Interfaccia grafica

```bash
just-code gui
```

Apre just-Code in una finestra (Chrome/Edge in modalità app, altrimenti il browser) con chat, pannello dei sub-agenti in tempo reale, finestre di conferma con il diff, interruttore TURBO, configurazione guidata e autocompletamento. Gira solo in locale (`127.0.0.1`, con un token casuale) e usa lo stesso motore, gli stessi comandi e la stessa configurazione del terminale. Opzioni: `--port <n>`, `--no-open`.

## Autocompletamento e suggerimenti

- `/` mostra i comandi; **Tab** completa anche gli argomenti (provider, modelli `provider:modello`, `on/off`, file `.json`…). Il testo suggerito appare in grigio dopo il cursore.
- `@` cerca i file del progetto (ricerca fuzzy): `sistema @src/auth/log` → `@src/auth/login.ts`. I file citati vengono segnalati all'orchestratore.
- **↑/↓** scorrono i suggerimenti, oppure la cronologia dei prompt (salvata in `~/.just-code/history.json`).
- A conversazione vuota just-Code propone dei prompt adatti al progetto (test, build, revisione delle modifiche…).

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
| `/setup` | configurazione guidata |
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

Tasti: `Tab` completa, `↑/↓` suggerimenti e cronologia, `Esc` interrompe il lavoro in corso, `Ctrl+C` due volte esce.

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
  core/                   comandi, autocompletamento, cronologia, configurazione guidata (condivisi da TUI e GUI)
  ui/                     Ink: logo animato, prompt con suggerimenti, setup, pannello agenti, permessi, TURBO
  gui/server.ts           server locale della GUI (SSE + API, solo 127.0.0.1 con token)
gui/                      interfaccia grafica (HTML/CSS/JS, font IBM Plex Mono incluso)
```

Ispirato all'esperienza d'uso di [Claude Code](https://github.com/anthropics/claude-code).
