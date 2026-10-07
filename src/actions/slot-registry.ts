export interface Coordinates {
	column: number;
	row: number;
}

/** Status keys ordered by position on the device (row by row): the first key is slot 0. */
export class SlotRegistry {
	readonly #keys = new Map<string, Coordinates | undefined>();
	#order: string[] = [];

	add(id: string, coordinates: Coordinates | undefined): void {
		this.#keys.set(id, coordinates);
		this.#sort();
	}

	remove(id: string): void {
		this.#keys.delete(id);
		this.#sort();
	}

	slotOf(id: string): number | undefined {
		const index = this.#order.indexOf(id);
		return index < 0 ? undefined : index;
	}

	idAt(slot: number): string | undefined {
		return this.#order[slot];
	}

	ids(): string[] {
		return [...this.#order];
	}

	// ponytail: one ordering across all devices; per-device slots if someone runs two Stream Decks.
	#sort(): void {
		const position = (c: Coordinates | undefined) => (c ? c.row * 1000 + c.column : Number.MAX_SAFE_INTEGER);
		this.#order = [...this.#keys.keys()].sort((a, b) => position(this.#keys.get(a)) - position(this.#keys.get(b)));
	}
}
