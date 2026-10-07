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

	it("parses the window list", async () => {
		const run = vi.fn(async () => '[{"hwnd":1,"processName":"claude","title":"Claude","path":"C:\\\\x"}]\r\n');
		expect(await createWindowHelper("s.ps1", run).list()).toEqual([{ hwnd: 1, processName: "claude", title: "Claude", path: "C:\\x" }]);
		expect(run).toHaveBeenCalledWith("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "s.ps1", "-List"]);
	});
});
