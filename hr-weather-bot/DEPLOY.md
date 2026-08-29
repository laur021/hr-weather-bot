# Deploying the HR Weather Advisory System

This is a **standalone Node/TypeScript bot**. It does **not** depend on OpenClaw —
it runs independently and talks to Telegram directly (grammY). The AI text
generation uses the DeepSeek API directly. You can run it on any machine with
Node.js 20+ (or Docker), next to or completely separate from OpenClaw.

## Per-site requirements

1. A **dedicated Telegram bot** — one per deployment. Never share a token across
   sites: Telegram allows only ONE consumer per token, and a second instance
   will cause `409 Conflict` and steal messages.
2. Two group chat IDs (HR + employees).
3. A DeepSeek API key (or set `AI_PROVIDER=mock` to test without one).

## Setup steps

1. **Copy the code** to the target machine (`hr-weather-bot/` folder, or
   `git clone` your repo).

2. **Create the bot:**
   - Open @BotFather → `/newbot` → name it (e.g. "HR Weather Bot") → pick a
     username → copy the token.

3. **Add the bot to both groups, as admin:**
   - HR group (e.g. "HR Weather Drafts")
   - Employee group (e.g. "ABC Employee Announcement")

4. **Disable group privacy** (so the bot sees free-text HR replies):
   - @BotFather → `/setprivacy` → choose the bot → **Disable**.

5. **Configure `.env`** (copy from `.env.example`):
   - `TELEGRAM_BOT_TOKEN=<new token>`
   - `AUTHORIZED_HR_CHAT_ID=<HR group id>` (a **negative** number)
   - `EMPLOYEE_CHAT_ID=<employee group id>` (a **negative** number)
   - `DEEPSEEK_API_KEY=<key>`
   - `WEATHER_SOURCE=open-meteo`
   - `OPEN_METEO_LATITUDE` / `OPEN_METEO_LONGITUDE` / `OPEN_METEO_LOCATION_NAME` = office location

6. **Discover the group IDs** (if you don't know them):
   ```bash
   npm install
   npm run discover
   ```
   Then send `@<botusername> ping` in each group. The script prints the
   `chat_id` for each (e.g. `chat_id=-1001234567890`). Use those values.

7. **Run it:**
   ```bash
   npm install
   npm start        # or: npm run dev (auto-reload)
   ```
   Or with Docker: `./deploy.sh` (bash) / `./deploy.ps1` (PowerShell).

8. **Verify** the full flow: weather alert → Compose Draft → Edit → Send to
   Employees → announcement appears in the employee group.

## Automated setup prompt (paste into your office OpenClaw/assistant)

```
Set up the HR Weather Advisory System bot on this machine, following the code
already in the `hr-weather-bot/` folder (read its README.md and DEPLOY.md).

1. Create a NEW Telegram bot via @BotFather (name "HR Weather Bot"), get its token.
2. Add the bot to both groups — "HR Weather Drafts" and "ABC Employee Announcement" —
   and make it admin in both.
3. Disable group privacy: @BotFather → /setprivacy → the bot → Disable.
4. Create hr-weather-bot/.env from .env.example:
   - TELEGRAM_BOT_TOKEN=<new token>
   - DEEPSEEK_API_KEY=<our DeepSeek key>
   - WEATHER_SOURCE=open-meteo
   - OPEN_METEO_LATITUDE / LONGITUDE / LOCATION_NAME = <office location>
5. Discover group chat IDs: run `npm install && npm run discover`, then have someone
   send "@<bot> ping" in each group, and read the printed negative chat_id values.
6. Set AUTHORIZED_HR_CHAT_ID and EMPLOYEE_CHAT_ID in .env to those values.
7. Run `npm install && npm start` (or deploy via Docker).
8. Verify the bot posts a weather alert to the HR group, and test the full flow
   (Compose Draft → Edit → Send to Employees) end-to-end.
```

## Gotchas

- **Group chat IDs are negative** (`-100…` / `-…`). Private chats are positive.
- **One token = one running instance.** Running the same token in two places
  causes 409 conflicts and lost messages.
- The **employee group is output-only**. Never set it as `AUTHORIZED_HR_CHAT_ID`.
- Bots can't be edited once their username is taken — pick a unique username per site.
