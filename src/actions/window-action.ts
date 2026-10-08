import { toDataUrl } from "../render/status-key.js";
import { renderWindowKey, type WindowKind } from "../render/window-key.js";
import type { WindowHelper } from "../win/focus-window.js";
import { matchWindow } from "../win/window-match.js";
import type { WatchedWindow, WindowWatch } from "../win/window-watch.js";
import type { KeyView } from "./key-view.js";

export type WindowControl = Pick<WindowHelper, "list" | "windowState" | "setWindow">;
type Watch = Pick<WindowWatch, "state" | "onChange" | "watch" | "unwatch">;

/** Before the first watched report, show the more likely action. */
const nextAction = (state: WatchedWindow | undefined): WindowKind =>
	state?.hwnd === 0 ? "none" : state?.maximized ? "minimize" : "maximize";

/**
 * "Claude Window" minimizes Claude Desktop when it is maximized, otherwise maximizes it (and brings it forward).
 * The key shows the next action from the watched window state.
 */
export class WindowKeys {
	readonly #views = new Map<string, KeyView>();

	constructor(
		private readonly windows: WindowControl,
		private readonly watch: Watch,
		private readonly log: (message: string) => void = () => {},
	) {
		watch.onChange(() => this.renderAll());
	}

	appear(view: KeyView): void {
		this.#views.set(view.id, view);
		this.watch.watch(view.id);
		this.#render(view);
	}

	disappear(id: string): void {
		this.#views.delete(id);
		this.watch.unwatch(id);
	}

	async press(view: KeyView): Promise<void> {
		try {
			const state = this.watch.state ?? (await this.#lookup());
			if (!state || state.hwnd === 0) {
				view.showAlert();
				return;
			}
			await this.windows.setWindow(state.hwnd, state.maximized ? "minimize" : "maximize");
		} catch (error) {
			this.log(`window toggle failed: ${error}`);
			view.showAlert();
		}
	}

	/** One-shot fallback while the watcher has not reported yet. */
	async #lookup(): Promise<WatchedWindow | undefined> {
		// No project: matchWindow falls through to the Claude Desktop window.
		const desktop = matchWindow("", await this.windows.list());
		return desktop ? { hwnd: desktop.hwnd, ...(await this.windows.windowState(desktop.hwnd)) } : undefined;
	}

	renderAll(): void {
		for (const view of this.#views.values()) this.#render(view);
	}

	#render(view: KeyView): void {
		view.setImage(toDataUrl(renderWindowKey(nextAction(this.watch.state))));
	}
}
