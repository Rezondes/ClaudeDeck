import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { WindowWatch } from "./window-watch.js";

function fakeProcess() {
	return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
}

function fakeSpawn() {
	const processes: ReturnType<typeof fakeProcess>[] = [];
	const spawn = vi.fn((_file: string, _args: string[]) => {
		const process = fakeProcess();
		processes.push(process);
		return process;
	});
	return { spawn, processes };
}

describe("WindowWatch", () => {
	it("parses one state per line and ignores garbage", () => {
		const { spawn, processes } = fakeSpawn();
		const watch = new WindowWatch("s.ps1", spawn);
		const changes = vi.fn();
		watch.onChange(changes);
		watch.watch("k1");
		expect(watch.state).toBeUndefined();

		const out = processes[0].stdout;
		out.emit("data", Buffer.from('{"hwnd":77,"minimized":false,'));
		expect(watch.state).toBeUndefined();
		out.emit("data", Buffer.from('"maximized":true}\r\nWARNING: noise\r\n'));
		expect(watch.state).toEqual({ hwnd: 77, minimized: false, maximized: true });
		expect(changes).toHaveBeenCalledTimes(1);

		out.emit("data", '{"hwnd":77,"minimized":false,"maximized":true}\r\n');
		expect(changes).toHaveBeenCalledTimes(1);

		for (const garbage of ['{"hwnd":"77","minimized":false,"maximized":true}', '{"hwnd":1.5,"minimized":false,"maximized":false}', '{"hwnd":5}', "[]", "null"]) {
			out.emit("data", `${garbage}\n`);
		}
		expect(watch.state).toEqual({ hwnd: 77, minimized: false, maximized: true });

		out.emit("data", '{"hwnd":0}\n');
		expect(watch.state).toEqual({ hwnd: 0, minimized: false, maximized: false });
		expect(changes).toHaveBeenCalledTimes(2);
	});

	it("starts with the first visible key and stops with the last", () => {
		const { spawn, processes } = fakeSpawn();
		const watch = new WindowWatch("C:\\p\\focus-window.ps1", spawn);
		expect(spawn).not.toHaveBeenCalled();

		watch.watch("k1");
		watch.watch("k2");
		watch.watch("k1");
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(spawn).toHaveBeenCalledWith("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\p\\focus-window.ps1", "-Watch", "-Parent", String(process.pid)]);

		processes[0].stdout.emit("data", '{"hwnd":0}\n');
		watch.unwatch("k1");
		expect(processes[0].kill).not.toHaveBeenCalled();
		watch.unwatch("k2");
		expect(processes[0].kill).toHaveBeenCalledTimes(1);
		expect(watch.state).toBeUndefined();

		watch.watch("k3");
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("restarts a watcher that exits on its own after 5 s while keys are visible", () => {
		vi.useFakeTimers();
		try {
			const { spawn, processes } = fakeSpawn();
			const log = vi.fn();
			const watch = new WindowWatch("s.ps1", spawn, log);
			const changes = vi.fn();
			watch.onChange(changes);
			watch.watch("k1");
			processes[0].stdout.emit("data", '{"hwnd":0}\n');
			changes.mockClear();

			processes[0].emit("error", new Error("spawn powershell ENOENT"));
			processes[0].emit("exit", 1);
			expect(log).toHaveBeenCalled();
			expect(watch.state).toBeUndefined();
			expect(changes).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(4999);
			expect(spawn).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1);
			expect(spawn).toHaveBeenCalledTimes(2);

			// Exit after the last key left: no restart.
			processes[1].emit("exit", 1);
			watch.unwatch("k1");
			vi.advanceTimersByTime(10_000);
			expect(spawn).toHaveBeenCalledTimes(2);

			// A key appearing during the delay starts at once; the timer then does not start a second one.
			watch.watch("k2");
			expect(spawn).toHaveBeenCalledTimes(3);
			processes[2].emit("exit", 1);
			watch.unwatch("k2");
			watch.watch("k2");
			expect(spawn).toHaveBeenCalledTimes(4);
			vi.advanceTimersByTime(5000);
			expect(spawn).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});
});
