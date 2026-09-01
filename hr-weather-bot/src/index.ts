/**
 * Legacy standalone entry point intentionally disabled.
 *
 * OpenClaw owns Telegram ingress and hourly scheduling. Use the
 * `openclaw:runner` script only through the trusted hr-weather plugin.
 */
console.error(
  "HR Weather Advisory is OpenClaw-managed. Start the OpenClaw gateway instead of this standalone process.",
);
process.exitCode = 1;
