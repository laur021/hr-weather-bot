import { CB, type CallbackAction } from "../constants.js";

/** Encode a callback `data` string: `action:eventId` or `action:eventId:version`. */
export function encodeCallback(
  action: CallbackAction,
  eventId: string,
  version?: number,
): string {
  return version === undefined
    ? `${action}:${eventId}`
    : `${action}:${eventId}:${version}`;
}

export interface DecodedCallback {
  action: CallbackAction;
  eventId: string;
  version?: number;
}

export class CallbackParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallbackParseError";
  }
}

/** Parse and validate a callback `data` string. */
export function decodeCallback(data: string | undefined): DecodedCallback {
  if (!data) throw new CallbackParseError("Missing callback data");
  const parts = data.split(":");
  if (parts.length < 2) throw new CallbackParseError(`Malformed callback: ${data}`);

  const [action, eventId, versionRaw] = parts;
  if (!(Object.values(CB) as string[]).includes(action)) {
    throw new CallbackParseError(`Unknown action: ${action}`);
  }

  const decoded: DecodedCallback = {
    action: action as CallbackAction,
    eventId,
  };

  if (versionRaw !== undefined) {
    const version = Number.parseInt(versionRaw, 10);
    if (Number.isNaN(version)) {
      throw new CallbackParseError(`Bad version in callback: ${data}`);
    }
    decoded.version = version;
  }

  return decoded;
}
