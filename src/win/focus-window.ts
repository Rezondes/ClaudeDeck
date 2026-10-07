import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LOCAL_ID } from "../desktop/session-catalog.js";
import type { WindowInfo } from "./window-match.js";

/** Runs a program with an argument array (never through a shell) and resolves its stdout. */
export type RunFile = (file: string, args: string[]) => Promise<string>;

const runFile: RunFile = async (file, args) => (await promisify(execFile)(file, args, { windowsHide: true, timeout: 5000 })).stdout;

export type WindowVerb = "minimize" | "maximize" | "restore";
const VERBS: readonly string[] = ["minimize", "maximize", "restore"] satisfies WindowVerb[];

export interface WindowState {
	minimized: boolean;
	maximized: boolean;
}

function handle(hwnd: number): string {
	if (!Number.isInteger(hwnd)) throw new Error(`invalid window handle: ${hwnd}`);
	return String(hwnd);
}

// ponytail: one PowerShell start per call (~0.5 s); a native FFI binding (koffi) if that ever feels slow.
export function createWindowHelper(scriptPath: string, run: RunFile = runFile) {
	const ps = (...args: string[]) => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]);
	return {
		async windowState(hwnd: number): Promise<WindowState> {
			return JSON.parse(await ps("-State", "-Hwnd", handle(hwnd)));
		},
		/** restore and maximize also bring the window to the foreground. */
		async setWindow(hwnd: number, verb: WindowVerb): Promise<void> {
			if (!VERBS.includes(verb)) throw new Error(`invalid window command: ${verb}`);
			await ps("-Window", verb, "-Hwnd", handle(hwnd));
		},
		async list(): Promise<WindowInfo[]> {
			return JSON.parse(await ps("-List"));
		},
		async focus(hwnd: number): Promise<void> {
			await ps("-Focus", handle(hwnd));
		},
		/** Opens claude://code/continue for this session and brings the Desktop window forward. */
		async openDesktopSession(localId: string): Promise<void> {
			if (!LOCAL_ID.test(localId)) throw new Error(`invalid desktop session id: ${JSON.stringify(localId)}`);
			await ps("-OpenSession", localId);
		},
	};
}

export type WindowHelper = ReturnType<typeof createWindowHelper>;
