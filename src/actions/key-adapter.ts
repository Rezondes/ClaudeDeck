import type { JsonObject, JsonValue } from "@elgato/utils";
import streamDeck, { SingletonAction, type DidReceiveSettingsEvent, type SendToPluginEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { KeyView } from "./key-view.js";

/** What a key controller (e.g. DecisionKeys) needs from Stream Deck events. */
export interface KeyController {
	appear(view: KeyView, ev: WillAppearEvent): void;
	disappear(id: string): void;
	press(view: KeyView): void;
	/** Key released; only controllers that tell short from long presses need it. */
	release?(view: KeyView): void;
	/** Property inspector changed this key's settings. */
	settingsChanged?(id: string, settings: Record<string, unknown>): void;
	/** Property inspector sent a message; a returned value goes back to it (e.g. dropdown items). */
	fromInspector?(payload: unknown): Promise<unknown> | undefined;
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

	override onKeyUp(ev: KeyUpEvent): void {
		this.controller.release?.(ev.action);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
		this.controller.settingsChanged?.(ev.action.id, ev.payload.settings);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		const answer = await this.controller.fromInspector?.(ev.payload);
		if (answer !== undefined) await streamDeck.ui.sendToPropertyInspector(answer as JsonValue);
	}
}
