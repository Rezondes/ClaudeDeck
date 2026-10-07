import { describe, expect, it, vi } from "vitest";

import { renderWindowKey } from "../render/window-key.js";
import { toDataUrl } from "../render/status-key.js";
import type { WindowInfo } from "../win/window-match.js";
import { WindowKeys, type WindowControl } from "./window-action.js";

const DESKTOP: WindowInfo = { hwnd: 77, processName: "claude", title: "Claude", path: "C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\claude.exe" };
const TERMINAL: WindowInfo = { hwnd: 5, processName: "WindowsTerminal", title: "claude", path: "C:\\wt.exe" };

const view = () => ({ id: "k1", setImage: vi.fn(), showAlert: vi.fn() });

function fakeWindows(state: { minimized: boolean; maximized: boolean }, list: WindowInfo[] = [TERMINAL, DESKTOP]) {
	return {
		list: vi.fn(async () => list),
		windowState: vi.fn(async () => state),
		setWindow: vi.fn(async () => {}),
	} satisfies WindowControl;
}

describe("WindowKeys", () => {
	it("renders its key on appear", () => {
		const v = view();
		new WindowKeys("maximize", fakeWindows({ minimized: false, maximized: false })).appear(v);
		expect(v.setImage).toHaveBeenCalledWith(toDataUrl(renderWindowKey("maximize")));
	});

	it("window key toggles minimize and restore", async () => {
		const normal = fakeWindows({ minimized: false, maximized: true });
		await new WindowKeys("window", normal).press(view());
		expect(normal.windowState).toHaveBeenCalledWith(77);
		expect(normal.setWindow).toHaveBeenCalledWith(77, "minimize");

		const minimized = fakeWindows({ minimized: true, maximized: false });
		await new WindowKeys("window", minimized).press(view());
		expect(minimized.setWindow).toHaveBeenCalledWith(77, "restore");
	});

	it("maximize key toggles maximize and normal size", async () => {
		const normal = fakeWindows({ minimized: false, maximized: false });
		await new WindowKeys("maximize", normal).press(view());
		expect(normal.setWindow).toHaveBeenCalledWith(77, "maximize");

		const minimized = fakeWindows({ minimized: true, maximized: false });
		await new WindowKeys("maximize", minimized).press(view());
		expect(minimized.setWindow).toHaveBeenCalledWith(77, "maximize");

		const maximized = fakeWindows({ minimized: false, maximized: true });
		await new WindowKeys("maximize", maximized).press(view());
		expect(maximized.setWindow).toHaveBeenCalledWith(77, "restore");
	});

	it("alerts without desktop window", async () => {
		const windows = fakeWindows({ minimized: false, maximized: false }, [TERMINAL]);
		const v = view();
		await new WindowKeys("window", windows).press(v);
		expect(v.showAlert).toHaveBeenCalled();
		expect(windows.setWindow).not.toHaveBeenCalled();
	});

	it("alerts when the window helper fails", async () => {
		const windows = fakeWindows({ minimized: false, maximized: false });
		windows.setWindow.mockRejectedValue(new Error("powershell failed"));
		const v = view();
		await new WindowKeys("maximize", windows).press(v);
		expect(v.showAlert).toHaveBeenCalled();
	});
});
