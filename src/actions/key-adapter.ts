import { SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { KeyView } from "./key-view.js";

/** What a key controller (e.g. DecisionKeys) needs from Stream Deck events. */
export interface KeyController {
	appear(view: KeyView, ev: WillAppearEvent): void;
	disappear(id: string): void;
	press(view: KeyView): void;
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
}
