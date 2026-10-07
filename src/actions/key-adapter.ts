import { SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { KeyView } from "./key-view.js";

/** What a key controller (e.g. DecisionKeys) needs from Stream Deck events. */
export interface KeyController {
	appear(view: KeyView, ev: WillAppearEvent): void;
	disappear(id: string): void;
	press(view: KeyView): void;
	/** Property inspector changed this key's settings. */
	settingsChanged?(id: string, settings: Record<string, unknown>): void;
}

/** Routes Stream Deck key events for one manifest UUID to a controller. No decorator needed. */
export class KeyAdapter extends SingletonAction {
	constructor(
		uuid: string,
		private readonly controller: KeyController,
	) {
		super();
		Object.assign(this, { manifestId: uuid });
	}

	override onWillAppear(ev: WillAppearEvent): void {
		if (ev.action.isKey()) this.controller.appear(ev.action, ev);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.controller.disappear(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		this.controller.press(ev.action);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
		this.controller.settingsChanged?.(ev.action.id, ev.payload.settings);
	}
}
