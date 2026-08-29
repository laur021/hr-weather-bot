# HR Weather Advisory System — Telegram Configuration & Authorization Spec

_Received 2026-08-29. Source: user-provided spec._

## Telegram Bot

- Bot username: `@AblazeHRAssistantBot`
- Responsibilities:
  - Sending weather alerts to HR
  - Receiving HR commands
  - Receiving button callbacks
  - Generating announcement drafts
  - Receiving HR draft revisions
  - Showing final announcement previews
  - Receiving final approval
  - Sending approved announcements to the employee group

## Authorized HR Group

- Group name: **HR Weather Drafts**
- Chat ID: `5368977850`
- Purpose: private operational group for HR + weather bot.
  - Weather alerts, drafts, approval requests, editing conversations, status updates, errors, and delivery confirmations belong here.

## Employee Announcement Group

- Group name: **ABC Employee Announcement**
- Chat ID: `5324314507`
- Purpose: employee-facing Telegram group. **Output-only** for this workflow.
- Employees must never receive: internal weather analysis, draft announcements, approval buttons, debugging messages, AI reasoning, weather API responses, error logs, HR conversations, discard notifications, internal workflow statuses.

## HR Authorization Model

- **Group-based** authorization.
- Anyone interacting with the bot from `HR Weather Drafts` is authorized.
- Do NOT hard-code individual HR Telegram user IDs unless later configured.
- Conceptual constants:
  - `AUTHORIZED_HR_CHAT_ID = 5368977850`
  - `EMPLOYEE_CHAT_ID = 5324314507`
- For every HR operation: `incomingChatId == AUTHORIZED_HR_CHAT_ID`

## Authorized HR Actions

Any member from the authorized HR group may:
- View weather alerts
- Select Compose Draft
- Generate an announcement
- Reply with draft instructions
- Edit/rewrite an announcement
- Request another version
- Approve an announcement
- Send an approved announcement
- Discard an announcement
- Request the latest weather status
- Review the current draft
- Retry a failed employee announcement

No requirement that the same person who started the draft approves it.

## Authorization Rules

- Authorization must be determined from the ORIGINAL Telegram chat context.
- Knowing a callback identifier / event ID / message ID / command / employee group ID / bot username does NOT grant authorization.
- Callback queries: `callbackQuery.message.chat.id == AUTHORIZED_HR_CHAT_ID`.
- Regular messages: `message.chat.id == AUTHORIZED_HR_CHAT_ID`.

## Private Message Rule

A user DMing the bot privately is NOT automatically authorized as HR, even if they belong to HR.
"If someone privately messages 'Send the announcement.' → do NOT send; respond that approval must happen in the authorized HR group."

## Employee Group Security

Messages from `ABC Employee Announcement` must NOT be treated as HR instructions (output-only).
Employees cannot: create/modify/approve drafts, send announcements, discard events, change weather config.

## Routing Rules

```
WEATHER SYSTEM → threat detected → HR Weather Drafts → HR interaction
→ Draft → Edit/review → Final preview → Explicit HR approval
→ ABC Employee Announcement
```

Never reverse. Employee group must never become an approval group.

## Complete Workflow

1. Create/update weather event on dangerous weather.
2. Send weather alert to HR Weather Drafts.
3. Include `📝 Compose Draft` + `❌ Discard`.
4. Wait for authorized HR action.
5. If Compose Draft → generate draft.
6. Send draft back to HR Weather Drafts.
7. Allow any HR member to reply with editing instructions.
8. Generate revised draft.
9. Show COMPLETE final preview.
10. Display `✅ Send to Employees` + `✏️ Edit` + `❌ Discard`.
11. Wait for explicit approval.
12. Verify approval originated from HR Weather Drafts.
13. Verify event is valid.
14. Verify event not already SENT.
15. Mark event APPROVED.
16. Send exactly the approved announcement to ABC Employee Announcement.
17. On successful delivery → mark SENT.
18. Send confirmation to HR Weather Drafts (e.g. `✅ Announcement Sent`, sent by, Asia/Manila timestamp).

## HR User Tracking (audit, not authorization)

- `createdByTelegramUserId`, `createdByTelegramUsername`, `createdByDisplayName`
- `editedByTelegramUserId`, `editedByTelegramUsername`
- `approvedByTelegramUserId`, `approvedByTelegramUsername`, `approvedByDisplayName`
- `approvedAt`

## Multiple HR Members

Always use the latest saved draft as authoritative.

## Concurrent Edit Protection

- Maintain `draftVersion` (increment each revision).
- Approval references version, e.g. `approve:weather_20260829_001:4`.
- Before sending verify `currentDraftVersion == approvedDraftVersion`.
- If stale → respond `⚠️ This announcement has been updated...` and show latest preview.

## Double-Send Protection

- Check `event.status` before send.
- Only `WAITING_FOR_APPROVAL` may transition to `APPROVED → SENDING → SENT`.
- If already `SENDING`/`SENT` → respond `ℹ️ This announcement has already been sent or is currently being sent.`
- Must be enforced by application logic, not solely AI.

## Final Approval Rule

Messages like "looks good"/"okay"/"nice"/"thanks"/"approved" must NOT auto-broadcast unless explicitly mapped.
Safest: use `✅ Send to Employees` button. Only that action triggers the employee send.

## Bot Responsibility Boundary

DeepSeek Pro (AI) may: analyze weather, classify severity, explain risks, generate alerts/drafts, revise drafts, interpret editing instructions, produce final text.
OpenClaw/backend MUST enforce: authorized HR chat ID, employee destination chat ID, workflow state, draft version, callback validation, duplicate-send protection, explicit approval, Telegram delivery, audit logging.
Never rely only on an AI prompt to protect the employee channel.

## Hard Rule

The system may automatically: CHECK WEATHER, ALERT HR, CREATE A DRAFT AFTER HR REQUESTS IT.
The system may NOT automatically: SEND AN EMPLOYEE ANNOUNCEMENT.
Only route to employee broadcast: Authorized HR Group → Final Draft → Explicit "Send to Employees" → backend validation → Employee Telegram Group.
No individual HR whitelist required.
