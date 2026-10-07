import { spawn as nodeSpawn } from "node:child_process";

import { scriptArgs, type WindowState } from "./focus-window.js";

/** The Claude Desktop window as `focus-window.ps1 -Watch` reports it; hwnd 0 means no Desktop window. */
export interface WatchedWindow extends WindowState {
	hwnd: number;
}

/** The part of a child process the watcher uses. */
export interface WatcherProcess {
	stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
	on(event: "error" | "exit", listener: (arg?: unknown) => void): unknown;
	kill(): unknown;
}

/** Starts a program with an argument array (never through a shell). */
export type SpawnWatcher = (file: string, args: string[]) => WatcherProcess;

const spawnWatcher: SpawnWatcher = (file, args) => nodeSpawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });

const RESTART_DELAY_MS = 5000;

function parseLine(line: string): WatchedWindow | undefined {
	try {
		const value = JSON.parse(line);
		if (!Number.isInteger(value?.hwnd)) return undefined;
		if (value.hwnd === 0) return { hwnd: 0, minimized: false, maximized: false };
		if (typeof value.minimized !== "boolean" || typeof value.maximized !== "boolean") return undefined;
		return { hwnd: value.hwnd, minimized: value.minimized, maximized: value.maximized };
	} catch {
		return undefined;
	}
}

/**
 * One long-running `focus-window.ps1 -Watch` that reports the Desktop window state every second.
 * Runs only while at least one key watches it.
 */
export class WindowWatch {
	readonly #keys = new Set<string>();
	readonly #listeners: (() => void)[] = [];
	#child: WatcherProcess | undefined;
	#buffer = "";
	#state: WatchedWindow | undefined;

	constructor(
		private readonly scriptPath: string,
		private readonly spawn: SpawnWatcher = spawnWatcher,
		private readonly log: (message: string) => void = () => {},
	) {}

	/** Latest reported state; undefined until the watcher has reported. */
	get state(): WatchedWindow | undefined {
		return this.#state;
	}

	onChange(listener: () => void): void {
		this.#listeners.push(listener);
	}

	watch(id: string): void {
		this.#keys.add(id);
		if (!this.#child) this.#start();
	}

	unwatch(id: string): void {
		this.#keys.delete(id);
		if (this.#keys.size > 0 || !this.#child) return;
		this.#child.kill();
		this.#forget();
	}

	#start(): void {
		const child = this.spawn("powershell", scriptArgs(this.scriptPath, "-Watch", "-Parent", String(process.pid)));
		this.#child = child;
		child.on("error", (error) => this.log(`window watcher failed: ${error}`));
		child.on("exit", () => this.#child === child && this.#exited());
		child.stdout?.on("data", (chunk) => this.#receive(String(chunk)));
	}

	/** The watcher died on its own: keys fall back to the unknown state; retry while any key is visible. */
	#exited(): void {
		this.#forget();
		this.#notify();
		setTimeout(() => {
			if (!this.#child && this.#keys.size > 0) this.#start();
		}, RESTART_DELAY_MS);
	}

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}

	#forget(): void {
		this.#child = undefined;
		this.#buffer = "";
		this.#state = undefined;
	}

	#receive(chunk: string): void {
		const lines = (this.#buffer + chunk).split("\n");
		this.#buffer = lines.pop() ?? "";
		for (const line of lines) {
			const next = parseLine(line.trim());
			if (!next || JSON.stringify(next) === JSON.stringify(this.#state)) continue;
			this.#state = next;
			this.#notify();
		}
	}
}
