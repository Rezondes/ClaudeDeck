/** The part of a Stream Deck key action that controllers use. Lets them run in tests without Stream Deck. */
export interface KeyView {
	/** Stable per placed key (the action instance id). */
	id: string;
	setImage(image: string): unknown;
	showAlert(): unknown;
}
