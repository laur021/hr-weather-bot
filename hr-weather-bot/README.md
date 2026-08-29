# HR Weather Advisory System

Telegram bot that turns weather threats into HR-approved employee announcements,
with **group-based authorization** and a strict approval workflow.

## Architecture

```
Weather source ──(threat detected)──▶ HR Weather Drafts (chat 5368977850)
                                        │  HR: Compose / Edit / Approve / Discard
                                        ▼
                                 DeepSeek draft generation
                                        │
                                 ✅ Send to Employees (explicit approval)
                                        ▼
                              ABC Employee Announcement (chat 5324314507)
```

The employee group is **output-only**. Only the explicit `✅ Send to Employees`
action (validated by backend code) can broadcast there.

## Security model

- **Authorization is group-based.** The only thing that authorizes an HR action
  is `incomingChatId == AUTHORIZED_HR_CHAT_ID`. Callback data, event IDs, commands,
  and the bot username grant nothing.
- **AI never broadcasts.** DeepSeek only composes/revises text. The backend
  (`state/stateMachine.ts`, `workflow.ts`) enforces state, versions, and sends.
- **Double-send protection.** Only `WAITING_FOR_APPROVAL → APPROVED → SENDING → SENT`
  is legal; a second send returns "already sent".
- **Concurrent-edit protection.** Each approval references a draft version; a
  stale approval is rejected and the latest preview is re-shown.

## Quick start

```bash
npm install
cp .env.example .env       # then fill in TELEGRAM_BOT_TOKEN (and DEEPSEEK_API_KEY)
npm run dev                # or: npm run build && node dist/index.js
```

## Configuration (`.env`)

| Var | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | — | **required**, from @BotFather |
| `AUTHORIZED_HR_CHAT_ID` | `5368977850` | HR Weather Drafts |
| `EMPLOYEE_CHAT_ID` | `5324314507` | ABC Employee Announcement |
| `AI_PROVIDER` | `deepseek` | `deepseek` or `mock` (no key needed) |
| `DEEPSEEK_API_KEY` | — | required when `AI_PROVIDER=deepseek` |
| `DEEPSEEK_MODEL` | `deepseek-chat` | any OpenAI-compatible model |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/chat/completions` | override for any compatible endpoint |
| `WEATHER_SOURCE` | `mock` | `mock`, `http`, or `noop` |
| `WEATHER_HTTP_URL` | — | for `http`: returns `{severity,title,description}` |
| `WEATHER_HTTP_INTERVAL_MS` | `600000` | polling interval for `http` |
| `DATA_DIR` | `./data` | JSON persistence location |

## Commands & buttons

- `/status` — latest advisory (HR group only)
- `/checkweather` — force a weather check (HR group only)
- `📝 Compose Draft` / `❌ Discard` — on the weather alert
- `✅ Send to Employees` / `✏️ Edit` / `❌ Discard` — on the draft preview
- Free-text in the HR group is treated as an edit instruction for the latest draft.

## Tests

```bash
npm test          # vitest, 18 tests
npm run typecheck
```

## Swapping persistence

`JsonFileStore` (in `src/store/json-store.ts`) is fine for a single-process bot.
To scale out, implement the `EventStore` interface (`src/store/store.ts`) with
SQLite/Postgres and wire it in `src/index.ts`.
