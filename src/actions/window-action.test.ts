import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { renderWindowKey } from "../render/window-key.js";
import { toDataUrl } from "../render/status-key.js";
import type { WindowInfo } from "../win/window-match.js";
import { WindowWatch } from "../win/window-watch.js";
import { WindowKeys, type WindowControl } from "./window-action.js";

const DESKTOP: WindowInfo = { hwnd: 77, processName: "claude", title: "Claude", path: "C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\claude.exe" };
const TERMINAL: WindowInfo = { hwnd: 5, processName: "WindowsTerminal", title: "claude", path: "C:\\wt.exe" };

const view = (id = "k1") => ({ id, setImage: vi.fn(), showAlert: vi.fn() });
const image = (kind: Parameters<typeof renderWindowKey>[0]) => toDataUrl(renderWindowKey(kind));

function fakeWindows(state: { minimized: boolean; maximized: boolean }, list: WindowInfo[] = [TERMINAL, DESKTOP]) {
	return {
		list: vi.fn(async () => list),
		windowState: vi.fn(async () => state),
		setWindow: vi.fn(async () => {}),
	} satisfies WindowControl;
}

/** A WindowWatch whose PowerShell process is a fake; report() writes one -Watch line. */
function fakeWatch() {
	const stdout = new EventEmitter();
	const watch = new WindowWatch("s.ps1", () => Object.assign(new EventEmitter(), { stdout, kill: vi.fn() }));
	return { watch, report: (line: object) => stdout.emit("data", `${JSON.stringify(line)}\n`) };
}

describe("WindowKeys", () => {
	it("press maximizes unless maximized, then minimizes", async () => {
		for (const [state, verb] of [
			[{ minimized: false, maximized: true }, "minimize"],
			[{ minimized: true, maximized: false }, "maximize"],
			[{ minimized: false, maximized: false }, "maximize"],
		] as const) {
			// Watched state decides, without asking PowerShell.
			const { watch, report } = fakeWatch();
			const watched = fakeWindows({ minimized: false, maximized: false }, []);
			const keys = new WindowKeys(watched, watch);
			keys.appear(view());
			report({ hwnd: 77, ...state });
			await keys.press(view());
			expect(watched.setWindow).toHaveBeenCalledWith(77, verb);
			expect(watched.list).not.toHaveBeenCalled();

			// No watched state yet: one-shot lookup.
			const oneShot = fakeWindows(state);
			await new WindowKeys(oneShot, fakeWatch().watch).press(view());
			expect(oneShot.windowState).toHaveBeenCalledWith(77);
			expect(oneShot.setWindow).toHaveBeenCalledWith(77, verb);
		}
	});

	it("key shows the next action from the watched state", () => {
		const { watch, report } = fakeWatch();
		const keys = new WindowKeys(fakeWindows({ minimized: false, maximized: false }), watch);
		const a = view("a");
		const b = view("b");
		keys.appear(a);
		keys.appear(b);
		expect(a.setImage).toHaveBeenLastCalledWith(image("maximize"));

		report({ hwnd: 77, minimized: false, maximized: true });
		expect(a.setImage).toHaveBeenLastCalledWith(image("minimize"));
		expect(b.setImage).toHaveBeenLastCalledWith(image("minimize"));

		keys.disappear("b");
		report({ hwnd: 77, minimized: true, maximized: false });
		expect(a.setImage).toHaveBeenLastCalledWith(image("maximize"));
		expect(b.setImage).toHaveBeenLastCalledWith(image("minimize"));

		report({ hwnd: 0 });
		expect(a.setImage).toHaveBeenLastCalledWith(image("none"));
	});

	it("alerts without desktop window", async () => {
		const windows = fakeWindows({ minimized: false, maximized: false }, [TERMINAL]);
		const v = view();
		await new WindowKeys(windows, fakeWatch().watch).press(v);
		expect(v.showAlert).toHaveBeenCalledTimes(1);

		const { watch, report } = fakeWatch();
		const keys = new WindowKeys(windows, watch);
		keys.appear(view());
		report({ hwnd: 0 });
		await keys.press(v);
		expect(v.showAlert).toHaveBeenCalledTimes(2);
		expect(windows.setWindow).not.toHaveBeenCalled();
	});

	it("alerts when the window helper fails", async () => {
		const windows = fakeWindows({ minimized: false, maximized: false });
		windows.setWindow.mockRejectedValue(new Error("powershell failed"));
		const v = view();
		await new WindowKeys(windows, fakeWatch().watch).press(v);
		expect(v.showAlert).toHaveBeenCalled();
	});
});
