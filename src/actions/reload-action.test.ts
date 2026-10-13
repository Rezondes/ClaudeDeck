import { describe, expect, it, vi } from "vitest";

import { ReloadKeys } from "./reload-action.js";

function view(id = "k1") {
	return { id, setImage: vi.fn(), showAlert: vi.fn(), showOk: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(reload: () => Promise<boolean>) {
	let now = 0;
	const restart = vi.fn();
	const keys = new ReloadKeys(reload, restart, () => now);
	const tap = async (v: ReturnType<typeof view>, holdMs = 100) => {
		keys.press(v);
		now += holdMs;
		keys.release(v);
		await flush();
	};
	return { keys, restart, tap };
}

describe("ReloadKeys", () => {
	it("short press reloads everything and confirms with a check mark", async () => {
		const reload = vi.fn(async () => true);
		const { restart, tap } = setup(reload);
		const v = view();
		await tap(v);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(v.showOk).toHaveBeenCalled();
		expect(v.showAlert).not.toHaveBeenCalled();
		expect(restart).not.toHaveBeenCalled();
	});

	it("alerts when a part of the reload failed or threw", async () => {
		const failed = view("a");
		await setup(async () => false).tap(failed);
		expect(failed.showAlert).toHaveBeenCalled();
		expect(failed.showOk).not.toHaveBeenCalled();

		const threw = view("b");
		await setup(() => Promise.reject(new Error("boom"))).tap(threw);
		expect(threw.showAlert).toHaveBeenCalled();
	});

	it("long press restarts the plugin instead of reloading", async () => {
		const reload = vi.fn(async () => true);
		const { restart, tap } = setup(reload);
		await tap(view(), 600);
		expect(restart).toHaveBeenCalledTimes(1);
		expect(reload).not.toHaveBeenCalled();
	});

	it("ignores a release without a press", async () => {
		const reload = vi.fn(async () => true);
		const { keys, restart } = setup(reload);
		keys.release(view());
		await flush();
		expect(reload).not.toHaveBeenCalled();
		expect(restart).not.toHaveBeenCalled();
	});
});
