import { describe, expect, it } from "vitest";

import { matchWindow, type WindowInfo } from "./window-match.js";

const desktop: WindowInfo = { hwnd: 100, processName: "claude", title: "Claude", path: "C:\\Program Files\\WindowsApps\\Claude_2.1_x64__abc\\app\\Claude.exe" };
const terminal: WindowInfo = { hwnd: 200, processName: "WindowsTerminal", title: "✳ ClaudeDeck - claude", path: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\wt.exe" };
const browser: WindowInfo = { hwnd: 300, processName: "opera", title: "ClaudeDeck - GitHub", path: "C:\\opera.exe" };

describe("matchWindow", () => {
	it("falls back to Claude Desktop window", () => {
		expect(matchWindow("api-svc", [browser, terminal, desktop])).toBe(desktop);
	});

	it("prefers terminal window with project name", () => {
		expect(matchWindow("claudedeck", [desktop, browser, terminal])).toBe(terminal);
		expect(matchWindow("ClaudeDeck", [{ ...terminal, processName: "pwsh" }, desktop])?.hwnd).toBe(200);
	});

	it("ignores other apps whose title contains the project", () => {
		expect(matchWindow("ClaudeDeck", [browser, desktop])).toBe(desktop);
	});

	it("matches the project name as a whole word only", () => {
		const appData: WindowInfo = { ...terminal, title: "C:\\Users\\x\\AppData\\Local" };
		expect(matchWindow("app", [appData, desktop])).toBe(desktop);
		expect(matchWindow("app", [{ ...terminal, title: "app - claude" }])?.hwnd).toBe(200);
		expect(matchWindow("", [terminal, desktop])).toBe(desktop);
	});

	it("returns null when nothing matches", () => {
		expect(matchWindow("ClaudeDeck", [browser])).toBeNull();
		expect(matchWindow("ClaudeDeck", [{ ...desktop, path: "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\claude.exe" }])).toBeNull();
	});
});
