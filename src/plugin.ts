import streamDeck from "@elgato/streamdeck";
import { fileURLToPath } from "node:url";

import { DecisionKeys } from "./actions/decision-action.js";
import { KeyAdapter } from "./actions/key-adapter.js";
import { ModeKeys, type ModeSettings } from "./actions/mode-action.js";
import { StatusKeys, type StatusSettings } from "./actions/status-action.js";
import { WindowKeys } from "./actions/window-action.js";
import { readDesktopSessions } from "./desktop/session-catalog.js";
import { readContextUsage } from "./domain/context-usage.js";
import { SessionStore } from "./domain/session-store.js";
import type { DecisionKind } from "./render/decision-key.js";
import { HOOK_PORT } from "./server/hook-contract.js";
import { createHookServer } from "./server/hook-server.js";
import { PendingApprovals } from "./server/pending-approvals.js";
import { createWindowHelper } from "./win/focus-window.js";
import { matchWindow } from "./win/window-match.js";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("ClaudeDeck");

const store = new SessionStore(Date.now);
const approvals = new PendingApprovals();
approvals.onSettled((sessionId) => store.approvalDecided(sessionId));
setInterval(() => store.tick(), 30_000);

let online = false;
const decisionKeys = (["allow", "always", "deny"] as DecisionKind[]).map((kind) => {
	const keys = new DecisionKeys(kind, approvals, () => online);
	streamDeck.actions.registerAction(new KeyAdapter(`com.claudedeck.streamdeck.${kind}`, keys));
	return keys;
});

const modeKeys = new ModeKeys(approvals, store);
streamDeck.actions.registerAction(
	new KeyAdapter("com.claudedeck.streamdeck.mode", {
		appear: (view, ev) => modeKeys.appear(view, ev.payload.settings as ModeSettings),
		disappear: (id) => modeKeys.disappear(id),
		press: (view) => modeKeys.press(view),
		settingsChanged: (id, settings) => modeKeys.settingsChanged(id, settings as ModeSettings),
	}),
);

const windows = createWindowHelper(fileURLToPath(new URL("../scripts/focus-window.ps1", import.meta.url)));
const focusProject = async (project: string) => {
	try {
		const window = matchWindow(project, await windows.list());
		if (window) await windows.focus(window.hwnd);
		else log.warn(`no window found for project "${project}"`);
		return window !== null;
	} catch (error) {
		log.error(`focusing "${project}" failed: ${error}`);
		return false;
	}
};
for (const kind of ["window", "maximize"] as const) {
	const keys = new WindowKeys(kind, windows, (message) => log.error(message));
	streamDeck.actions.registerAction(new KeyAdapter(`com.claudedeck.streamdeck.${kind}`, keys));
}

const statusKeys = new StatusKeys(store, readContextUsage, Date.now, focusProject, () => readDesktopSessions());
void statusKeys.seed();
streamDeck.actions.registerAction(
	new KeyAdapter("com.claudedeck.streamdeck.status", {
		appear: (view, ev) => statusKeys.appear(view, ev.action.isKey() ? ev.action.coordinates : undefined, ev.payload.settings as StatusSettings),
		disappear: (id) => statusKeys.disappear(id),
		press: (view) => statusKeys.press(view),
		settingsChanged: (id, settings) => statusKeys.settingsChanged(id, settings as StatusSettings),
	}),
);

const server = createHookServer({
	onEvent: (event) => {
		store.handle(event);
		statusKeys.hookEvent(event);
		modeKeys.renderAll(); // "most recently active session" can change without a state change
	},
	approvals,
	log: (message) => log.error(message),
});
server.listen(HOOK_PORT).then((ok) => {
	online = ok;
	if (ok) log.info(`hook server listening on 127.0.0.1:${HOOK_PORT}`);
	for (const keys of decisionKeys) keys.renderAll();
});

streamDeck.connect();
