import { config as loadEnv } from "dotenv";
loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}
const base = `https://api.telegram.org/bot${token}`;

// Optional long-poll wait (seconds) to catch live messages.
const pollSec = Number.parseInt(process.env.POLL_SECONDS ?? "0", 10);

async function main(): Promise<void> {
  const me = (await (await fetch(`${base}/getMe`)).json()) as {
    result?: {
      username?: string;
      id?: number;
      can_read_all_group_messages?: boolean;
    };
  };
  const r = me.result;
  console.log(`Bot: @${r?.username} (id ${r?.id})`);
  console.log(
    `Group privacy (can_read_all_group_messages): ${r?.can_read_all_group_messages} — should be "true"`,
  );

  const wh = (await (await fetch(`${base}/getWebhookInfo`)).json()) as {
    result?: { url?: string };
  };
  console.log(
    `Webhook: ${wh.result?.url || "(none)"} — should be "(none)" for long-polling`,
  );

  console.log(
    `\nListening ${pollSec}s for updates. Send "@${r?.username} ping" in each group to discover its chat ID.\n`,
  );

  const res = (await (
    await fetch(`${base}/getUpdates?timeout=${pollSec}&limit=100`)
  ).json()) as {
    ok?: boolean;
    result?: Array<{
      message?: { chat?: { id: number; type: string; title?: string; first_name?: string } };
      my_chat_member?: { chat?: { id: number; type: string; title?: string } };
      channel_post?: { chat?: { id: number; type: string; title?: string } };
    }>;
  };

  const ups = res.result ?? [];
  if (ups.length === 0) {
    console.log("No updates received.");
    return;
  }
  for (const u of ups) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat) {
      console.log(
        `chat_id=${chat.id}  type=${chat.type}  title=${chat.title ?? chat.first_name ?? "?"}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
