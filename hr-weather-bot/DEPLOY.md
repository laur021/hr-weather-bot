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

## Production deployment to the office EC2 host through GitHub Actions

The repository includes a workflow that deploys every validated push to the
`main` branch to the single office EC2 runner labeled `OPSA-STAGING`. Although
that EC2 host and runner use a staging label, it runs this bot as the live
production service. It is deliberately separate from the production Auto
Scaling Group.

### One-time production GitHub setup

1. In the repository, create a GitHub **Environment** named `main`.
2. Add these **Environment secrets**:
   - `TELEGRAM_BOT_TOKEN` - the token for the new office bot created with
     @BotFather. It must have the form `bot-id:secret`.
   - `DEEPSEEK_API_KEY`
   - `AUTHORIZED_HR_CHAT_ID`
   - `EMPLOYEE_CHAT_ID`
   - `OPENAI_API_KEY` (optional and reserved for future use; the current bot
     uses DeepSeek only)
3. Optionally add these Environment variables to override the defaults:
   `AI_PROVIDER`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `WEATHER_SOURCE`,
   `OPEN_METEO_LATITUDE`, `OPEN_METEO_LONGITUDE`,
   `OPEN_METEO_LOCATION_NAME`, `WEATHER_POLL_INTERVAL_MS`, and `LOG_LEVEL`.
4. Ensure Docker and the GitHub Actions self-hosted runner are configured to
   start automatically on the EC2 Windows machine.

### Cutover and single-instance rule

- Stop and remove the old home-machine bot from the live HR and employee
  groups before enabling the office bot. Two active bots in the same live
  groups can produce duplicate alerts.
- Add the new office bot to both live groups as an admin and disable its group
  privacy through @BotFather.
- Do not deploy this bot to the production Auto Scaling Group. The bot uses
  Telegram long polling and local state, so it must run as one instance only.

On deployment, GitHub Actions creates a temporary `.env` from the `main`
Environment values, runs `deploy.ps1`, verifies the `hr-weather-bot`
container, and removes the temporary file. Docker receives the variables when
the container starts. Its `--restart unless-stopped` policy starts it again
after an EC2 reboot or process failure.

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
