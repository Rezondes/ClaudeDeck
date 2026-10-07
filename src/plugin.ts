import streamDeck from "@elgato/streamdeck";
import { fileURLToPath } from "node:url";

import { DecisionKeys } from "./actions/decision-action.js";
import { KeyAdapter } from "./actions/key-adapter.js";
import { StatusKeys, type StatusSettings } from "./actions/status-action.js";
import { UsageKeys } from "./actions/usage-action.js";
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
import { WindowWatch } from "./win/window-watch.js";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("ClaudeDeck");

const store = new SessionStore(Date.now);
const approvals = new PendingApprovals();
approvals.onSettled((sessionId) => store.approvalDecided(sessionId));
setInterval(() => store.tick(), 30_000);

let online = false;
const decisionKeys = (["allow", "always", "deny"] as DecisionKind[]).map((kind) => {
	const keys = new DecisionKeys(kind, approvals, () => online, (sessionId, project) => store.get(sessionId)?.title || project);
	streamDeck.actions.registerAction(new KeyAdapter(`com.claudedeck.streamdeck.${kind}`, keys));
	return keys;
});

const scriptPath = fileURLToPath(new URL("../scripts/focus-window.ps1", import.meta.url));
const windows = createWindowHelper(scriptPath);
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
const openSession = async (localId: string) => {
	try {
		await windows.openDesktopSession(localId);
		return true;
	} catch (error) {
		log.error(`opening desktop session ${localId} failed: ${error}`);
		return false;
	}
};
const openNeedsInput = async () => {
	try {
		await windows.openNeedsInput();
		return true;
	} catch (error) {
		log.error(`opening sessions waiting for input failed: ${error}`);
		return false;
	}
};
const windowWatch = new WindowWatch(scriptPath, undefined, (message) => log.error(message));
streamDeck.actions.registerAction(
	new KeyAdapter("com.claudedeck.streamdeck.window", new WindowKeys(windows, windowWatch, (message) => log.error(message))),
);

streamDeck.actions.registerAction(new KeyAdapter("com.claudedeck.streamdeck.usage", new UsageKeys(store, Date.now)));

const statusKeys = new StatusKeys(store, readContextUsage, Date.now, focusProject, () => readDesktopSessions(), openSession, openNeedsInput);
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
	},
	onModuleEvent: (event) => store.handleModule(event),
	approvals,
	log: (message) => log.error(message),
});
server.listen(HOOK_PORT).then((ok) => {
	online = ok;
	if (ok) log.info(`hook server listening on 127.0.0.1:${HOOK_PORT}`);
	for (const keys of decisionKeys) keys.renderAll();
});

streamDeck.connect();
