import { readFileSync } from "node:fs";

/**
 * Standard stdout JSON envelope (mirrors PRD §5.3).
 *
 * Every CLI command prints exactly one of these as the LAST line of stdout,
 * so AI agents can parse a fixed schema regardless of which command ran.
 */

/** @returns {string} ISO timestamp in local time */
function nowIso() {
  return new Date().toISOString();
}

const APP_VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

/**
 * @typedef {{command:string, message:string, data?:any, warnings?:string[], meta?:object}} SuccessArgs
 * @param {SuccessArgs} args
 */
export function successEnvelope({ command, message, data, warnings, meta }) {
  return JSON.stringify({
    status: "success",
    command,
    message,
    data,
    warnings: warnings ?? [],
    errors: null,
    meta: { appVersion: APP_VERSION, time: nowIso(), ...meta },
  });
}

/**
 * @typedef {{command:string, message:string, code?:string}} ErrorArgs
 * @param {ErrorArgs} args
 */
export function errorEnvelope({ command, message, code }) {
  return JSON.stringify({
    status: "error",
    command,
    message,
    data: null,
    warnings: [],
    errors: [{ code: code ?? "EUNKNOWN", message }],
    meta: { appVersion: APP_VERSION, time: nowIso() },
  });
}

/** Print the envelope to stdout (final line). */
export function emit(line) {
  process.stdout.write(line + "\n");
}

/** Print a human-readable error to stderr and exit non-zero. */
export function fail(stderrMsg, envelopeLine) {
  process.stderr.write(stderrMsg + "\n");
  emit(
    envelopeLine ??
      errorEnvelope({
        command: process.argv[3] ?? "unknown",
        message: stderrMsg,
      }),
  );
  process.exit(1);
}
