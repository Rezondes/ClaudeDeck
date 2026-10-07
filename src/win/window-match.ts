/** A top-level window as listed by scripts/focus-window.ps1 -List. */
export interface WindowInfo {
	hwnd: number;
	processName: string;
	title: string;
	path: string;
}

const TERMINALS = new Set(["windowsterminal", "pwsh", "powershell", "cmd", "wezterm-gui", "alacritty"]);

/**
 * The window to bring forward for a session of this project. Hook payloads do not say whether a session runs
 * in Claude Desktop or a terminal (docs/spike-results.md AC7), so: a terminal whose title names the project,
 * else the Claude Desktop window.
 */
export function matchWindow(project: string, windows: WindowInfo[]): WindowInfo | null {
	// Whole word, so "app" does not match "...\AppData\...". Dashes count as part of a name ("web-app").
	const name = new RegExp(`(?<![\\w-])${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
	const terminal = project ? windows.find((w) => TERMINALS.has(w.processName.toLowerCase()) && name.test(w.title)) : undefined;
	const desktop = windows.find((w) => w.processName.toLowerCase() === "claude" && /\\WindowsApps\\Claude_/i.test(w.path));
	return terminal ?? desktop ?? null;
}
