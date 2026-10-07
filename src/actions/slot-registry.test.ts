import { describe, expect, it } from "vitest";

import { SlotRegistry } from "./slot-registry.js";

describe("SlotRegistry", () => {
	it("orders keys by device position", () => {
		const slots = new SlotRegistry();
		slots.add("c", { column: 2, row: 0 });
		slots.add("a", { column: 0, row: 0 });
		slots.add("b", { column: 1, row: 0 });
		slots.add("d", { column: 0, row: 1 });
		expect(["a", "b", "c", "d"].map((id) => slots.slotOf(id))).toEqual([0, 1, 2, 3]);
		expect(slots.idAt(3)).toBe("d");
	});

	it("reassigns slots when a key disappears", () => {
		const slots = new SlotRegistry();
		slots.add("a", { column: 0, row: 0 });
		slots.add("b", { column: 1, row: 0 });
		slots.add("c", { column: 2, row: 0 });
		slots.remove("a");
		expect([slots.slotOf("b"), slots.slotOf("c"), slots.slotOf("a")]).toEqual([0, 1, undefined]);
	});

	it("keys without coordinates (multi-action) go last", () => {
		const slots = new SlotRegistry();
		slots.add("x", undefined);
		slots.add("a", { column: 4, row: 2 });
		expect([slots.slotOf("a"), slots.slotOf("x")]).toEqual([0, 1]);
	});
});
