import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { WindowInfo } from "./window-match.js";

/** Runs a program with an argument array (never through a shell) and resolves its stdout. */
export type RunFile = (file: string, args: string[]) => Promise<string>;

const runFile: RunFile = async (file, args) => (await promisify(execFile)(file, args, { windowsHide: true, timeout: 5000 })).stdout;

// ponytail: one PowerShell start per call (~0.5 s); a native FFI binding (koffi) if that ever feels slow.
export function createWindowHelper(scriptPath: string, run: RunFile = runFile) {
	const ps = (...args: string[]) => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]);
	return {
		async list(): Promise<WindowInfo[]> {
			return JSON.parse(await ps("-List"));
		},
		async focus(hwnd: number): Promise<void> {
			if (!Number.isInteger(hwnd)) throw new Error(`invalid window handle: ${hwnd}`);
			await ps("-Focus", String(hwnd));
		},
	};
}

export type WindowHelper = ReturnType<typeof createWindowHelper>;
