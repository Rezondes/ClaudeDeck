import { describe, expect, it, vi } from "vitest";

import { createWindowHelper } from "./focus-window.js";

describe("window helper", () => {
	it("passes hwnd as integer argument", async () => {
		const run = vi.fn(async () => "");
		await createWindowHelper("C:\\p\\focus-window.ps1", run).focus(133116);
		expect(run).toHaveBeenCalledWith("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\p\\focus-window.ps1", "-Focus", "133116"]);
	});

	it("refuses non-integer handles", async () => {
		const run = vi.fn(async () => "");
		const helper = createWindowHelper("s.ps1", run);
		await expect(helper.focus(1.5)).rejects.toThrow();
		await expect(helper.focus(Number.NaN)).rejects.toThrow();
		expect(run).not.toHaveBeenCalled();
	});

	it("window commands pass fixed verbs and integer handles", async () => {
		const run = vi.fn(async () => '{"minimized":true,"maximized":false}\r\n');
		const helper = createWindowHelper("s.ps1", run);
		const base = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "s.ps1"];
		expect(await helper.windowState(42)).toEqual({ minimized: true, maximized: false });
		expect(run).toHaveBeenLastCalledWith("powershell", [...base, "-State", "-Hwnd", "42"]);
		for (const verb of ["minimize", "maximize", "restore"] as const) {
			await helper.setWindow(42, verb);
			expect(run).toHaveBeenLastCalledWith("powershell", [...base, "-Window", verb, "-Hwnd", "42"]);
		}
		run.mockClear();
		await expect(helper.windowState(1.5)).rejects.toThrow();
		await expect(helper.setWindow(Number.NaN, "minimize")).rejects.toThrow();
		await expect(helper.setWindow(42, "close" as never)).rejects.toThrow();
		await expect(helper.setWindow(42, "-Focus 1" as never)).rejects.toThrow();
		expect(run).not.toHaveBeenCalled();
	});

	it("parses the window list", async () => {
		const run = vi.fn(async () => '[{"hwnd":1,"processName":"claude","title":"Claude","path":"C:\\\\x"}]\r\n');
		expect(await createWindowHelper("s.ps1", run).list()).toEqual([{ hwnd: 1, processName: "claude", title: "Claude", path: "C:\\x" }]);
		expect(run).toHaveBeenCalledWith("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "s.ps1", "-List"]);
	});
});
