/** Contract between the Claude Code plugin (claude-plugin/hooks/hooks.json) and the hook server. */
export const HOOK_PORT = 37419;
export const HOOK_BASE_URL = `http://127.0.0.1:${HOOK_PORT}/hook`;

/** SessionStart is missing on purpose: Claude Code does not support HTTP hooks for it (docs/spike-results.md). */
export const HOOK_EVENTS = [
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"PermissionRequest",
	"Notification",
	"Stop",
	"SessionEnd",
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

/**
 * Contract with the plugin module (claude-module/hooks/register.ts), which posts to MODULE_BASE_URL/<event>
 * and polls GET MODULE_BASE_URL/commands?session=<id> for { commands: ModuleCommand[] } (src/server/command-queue.ts).
 */
export const MODULE_BASE_URL = `http://127.0.0.1:${HOOK_PORT}/module`;
export const MODULE_EVENTS = ["session-start", "turn-start", "usage"] as const;

export type ModuleEventName = (typeof MODULE_EVENTS)[number];

/** Seconds the server holds a PermissionRequest before it falls back to the normal prompt. */
export const APPROVAL_TIMEOUT_SECONDS = 60;
