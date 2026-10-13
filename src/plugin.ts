import streamDeck from "@elgato/streamdeck";
import { fileURLToPath } from "node:url";

import { DecisionKeys } from "./actions/decision-action.js";
import { KeyAdapter } from "./actions/key-adapter.js";
import { ProjectKeys, type ProjectSettings } from "./actions/project-action.js";
import { startRefresh } from "./actions/refresh.js";
import { ReloadKeys } from "./actions/reload-action.js";
import { StatusKeys, type StatusSettings } from "./actions/status-action.js";
import { UsageKeys } from "./actions/usage-action.js";
import { WindowKeys } from "./actions/window-action.js";
import { readDesktopSessions } from "./desktop/session-catalog.js";
import { readContextUsage } from "./domain/context-usage.js";
import { SessionStore } from "./domain/session-store.js";
import { localProjects, readProjectFolders } from "./projects/local-projects.js";
import type { DecisionKind } from "./render/decision-key.js";
import { CommandQueue } from "./server/command-queue.js";
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
const commands = new CommandQueue(Date.now);
setInterval(() => commands.expire(), 1000);

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
const windowKeys = new WindowKeys(windows, windowWatch, (message) => log.error(message));
streamDeck.actions.registerAction(new KeyAdapter("com.claudedeck.streamdeck.window", windowKeys));

const usageKeys = new UsageKeys(store, Date.now);
streamDeck.actions.registerAction(new KeyAdapter("com.claudedeck.streamdeck.usage", usageKeys));

const statusKeys = new StatusKeys(store, readContextUsage, Date.now, focusProject, () => readDesktopSessions(), openSession, openNeedsInput, (sessionId, turnId, onExpired) =>
	commands.add(sessionId, turnId, onExpired),
);
void statusKeys.seed();
streamDeck.actions.registerAction(
	new KeyAdapter("com.claudedeck.streamdeck.status", {
		appear: (view, ev) => statusKeys.appear(view, ev.action.isKey() ? ev.action.coordinates : undefined, ev.payload.settings as StatusSettings),
		disappear: (id) => statusKeys.disappear(id),
		press: (view) => statusKeys.press(view),
		release: (view) => statusKeys.release(view),
		settingsChanged: (id, settings) => statusKeys.settingsChanged(id, settings as StatusSettings),
	}),
);
let lastFolderCount: number | undefined;
const projectKeys = new ProjectKeys(
	async () => {
		const folders = await readProjectFolders();
		if (folders.length !== lastFolderCount) log.info(`project folders: ${folders.length}`);
		lastFolderCount = folders.length;
		return localProjects(folders, await readDesktopSessions(), (id) => store.get(id)?.state);
	},
	openSession,
	async (projectId, threadId) => {
		try {
			await windows.openDesktopProject(projectId, threadId);
			return true;
		} catch (error) {
			log.error(`opening desktop project ${projectId} failed: ${error}`);
			return false;
		}
	},
	// An empty project name matches the Claude Desktop window.
	() => focusProject(""),
	(message) => log.error(message),
);
// Hook events change thread states; reload once they settle instead of rereading the catalog per event.
let projectReload: ReturnType<typeof setTimeout> | undefined;
store.onChange(() => {
	clearTimeout(projectReload);
	projectReload = setTimeout(() => void projectKeys.reload(), 1000);
});
streamDeck.actions.registerAction(
	new KeyAdapter("com.claudedeck.streamdeck.project", {
		appear: (view, ev) => projectKeys.appear(view, ev.payload.settings as ProjectSettings),
		disappear: (id) => projectKeys.disappear(id),
		press: (view) => projectKeys.press(view),
		settingsChanged: (id, settings) => projectKeys.settingsChanged(id, settings as ProjectSettings),
		fromInspector: (payload) => ((payload as { event?: unknown } | null)?.event === "getProjects" ? projectKeys.items() : undefined),
	}),
);

const allKeys = [statusKeys, ...decisionKeys, usageKeys, windowKeys, projectKeys];
startRefresh(allKeys);

const reloadKeys = new ReloadKeys(
	async () => {
		const seeded = await statusKeys.seed();
		statusKeys.rereadContext();
		const projects = await projectKeys.reload();
		for (const keys of allKeys) keys.renderAll();
		return seeded && projects;
	},
	// Same as `npm run reload`: Stream Deck starts the plugin again after its process ends.
	() => process.kill(process.pid),
);
streamDeck.actions.registerAction(new KeyAdapter("com.claudedeck.streamdeck.reload", reloadKeys));

const server = createHookServer({
	onEvent: (event) => {
		store.handle(event);
		statusKeys.hookEvent(event);
	},
	onModuleEvent: (event) => store.handleModule(event),
	approvals,
	commands,
	log: (message) => log.error(message),
});
server.listen(HOOK_PORT).then((ok) => {
	online = ok;
	if (ok) log.info(`hook server listening on 127.0.0.1:${HOOK_PORT}`);
	for (const keys of decisionKeys) keys.renderAll();
});

streamDeck.connect();
