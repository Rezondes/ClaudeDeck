import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../projects/project-source.js";
import { ProjectKeys } from "./project-action.js";

const PROJECTS: ProjectSummary[] = [
	{ id: "p2", name: "Website", threads: [] },
	{
		id: "p1",
		name: "ClaudeDeck",
		threads: [
			{ id: "t1", title: "README", state: "working" },
			{ id: "t2", title: "Projects", state: "input" },
		],
	},
];

const timers = { setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>), clearInterval: vi.fn() };

function view(id = "k1") {
	const images: string[] = [];
	return { id, images, last: () => decodeURIComponent(images.at(-1) ?? ""), setImage: (i: string) => images.push(i), showAlert: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ProjectKeys", () => {
	it("shows the chosen project's open threads and most urgent state", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1" });
		await flush();
		expect(v.last()).toContain(">ClaudeDeck<");
		expect(v.last()).toContain(">2<");
		expect(v.last()).toContain(">1 Input<");
	});

	it("asks for a project until one is chosen", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, undefined, timers);
		const v = view();
		keys.appear(v, {});
		await flush();
		expect(v.last()).toContain(">Select<");
		keys.settingsChanged("k1", { projectId: "p2" });
		expect(v.last()).toContain(">Website<");
		expect(v.last()).toContain(">0<");
	});

	it("says not found when the project is gone", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "gone" });
		await flush();
		expect(v.last()).toContain(">Not<");
	});

	it("keeps the last values marked offline and alerts on press when the source fails", async () => {
		let fail = false;
		const keys = new ProjectKeys(async () => (fail ? Promise.reject(new Error("down")) : PROJECTS), undefined, timers);
		const v = view();
		keys.appear(v, { projectId: "p1" });
		await flush();
		fail = true;
		keys.press(v);
		await flush();
		expect(v.last()).toContain(">Offline<");
		expect(v.last()).toContain(">ClaudeDeck<");
		expect(v.showAlert).toHaveBeenCalled();
	});

	it("lists projects for the dropdown sorted by name", async () => {
		const keys = new ProjectKeys(async () => PROJECTS, undefined, timers);
		expect(await keys.items()).toEqual({
			event: "getProjects",
			items: [
				{ label: "ClaudeDeck (2)", value: "p1" },
				{ label: "Website (0)", value: "p2" },
			],
		});
	});

	it("polls only while a key is visible", () => {
		const t = { setInterval: vi.fn(() => 7 as unknown as ReturnType<typeof setInterval>), clearInterval: vi.fn() };
		const keys = new ProjectKeys(async () => PROJECTS, undefined, t);
		keys.appear(view("a"), {});
		keys.appear(view("b"), {});
		expect(t.setInterval).toHaveBeenCalledTimes(1);
		keys.disappear("a");
		expect(t.clearInterval).not.toHaveBeenCalled();
		keys.disappear("b");
		expect(t.clearInterval).toHaveBeenCalledWith(7);
	});
});
