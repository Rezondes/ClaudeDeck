import { toDataUrl } from "../render/status-key.js";
import { renderWindowKey, type WindowKind } from "../render/window-key.js";
import type { WindowHelper } from "../win/focus-window.js";
import { matchWindow } from "../win/window-match.js";
import type { KeyView } from "./key-view.js";

export type WindowControl = Pick<WindowHelper, "list" | "windowState" | "setWindow">;

/**
 * "Claude Window" minimizes Claude Desktop, or restores it when minimized. "Claude Maximize" maximizes it, or
 * restores normal size when maximized. restore and maximize also bring the window to the foreground.
 */
export class WindowKeys {
	constructor(
		private readonly kind: WindowKind,
		private readonly windows: WindowControl,
		private readonly log: (message: string) => void = () => {},
	) {}

	appear(view: KeyView): void {
		view.setImage(toDataUrl(renderWindowKey(this.kind)));
	}

	disappear(_id: string): void {}

	async press(view: KeyView): Promise<void> {
		try {
			// No project: matchWindow falls through to the Claude Desktop window.
			const desktop = matchWindow("", await this.windows.list());
			if (!desktop) {
				view.showAlert();
				return;
			}
			const { minimized, maximized } = await this.windows.windowState(desktop.hwnd);
			const verb = this.kind === "window" ? (minimized ? "restore" : "minimize") : maximized ? "restore" : "maximize";
			await this.windows.setWindow(desktop.hwnd, verb);
		} catch (error) {
			this.log(`window ${this.kind} failed: ${error}`);
			view.showAlert();
		}
	}
}
