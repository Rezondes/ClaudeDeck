import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HookEvent } from "../domain/hook-event.js";
import { createHookServer, type HookServer } from "./hook-server.js";
import { PendingApprovals } from "./pending-approvals.js";

const payload = (extra: object = {}) => ({
	session_id: "s1",
	transcript_path: "t.jsonl",
	cwd: "F:\\Code\\ClaudeDeck",
	permission_mode: "default",
	...extra,
});

let server: HookServer | undefined;

async function start() {
	const onEvent = vi.fn<(event: HookEvent) => void>();
	const approvals = new PendingApprovals();
	server = createHookServer({ onEvent, approvals, log: () => {} });
	expect(await server.listen(0)).toBe(true);
	const base = `http://127.0.0.1:${server.port()}`;
	const post = (path: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
		fetch(base + path, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: typeof body === "string" ? body : JSON.stringify(body),
			signal,
		});
	return { onEvent, approvals, base, post };
}

afterEach(async () => {
	await server?.close();
	server = undefined;
});

describe("hook server", () => {
	it("rejects unknown paths, invalid JSON, invalid fields and oversized bodies", async () => {
		const { onEvent, post } = await start();
		expect((await post("/hook/SessionStart", payload())).status).toBe(404);
		expect((await post("/other", payload())).status).toBe(404);
		expect((await post("/hook/Stop", "{not json")).status).toBe(400);
		expect((await post("/hook/Stop", payload({ session_id: 42 }))).status).toBe(400);
		expect((await post("/hook/Stop", payload({ cwd: undefined }))).status).toBe(400);
		expect((await post("/hook/PermissionRequest", payload({ tool_input: {} }))).status).toBe(400);
		expect((await post("/hook/Stop", payload(), { "content-type": "Application/JSON" })).status).toBe(200);
		expect((await post("/hook/Stop", payload({ pad: "x".repeat(1024 * 1024) }))).status).toBe(413);
		expect(onEvent).toHaveBeenCalledOnce(); // only the Application/JSON one
	});

	it("rejects browser-style requests", async () => {
		const { onEvent, base, post } = await start();
		const fromBrowser = await post("/hook/Stop", payload(), { origin: "https://evil.example" });
		const plainText = await post("/hook/Stop", JSON.stringify(payload()), { "content-type": "text/plain" });
		const preflight = await fetch(`${base}/hook/Stop`, { method: "OPTIONS" });
		expect([fromBrowser.status, plainText.status, preflight.status]).toEqual([403, 415, 405]);
		for (const res of [fromBrowser, plainText, preflight]) {
			expect([...res.headers.keys()].some((h) => h.startsWith("access-control-allow"))).toBe(false);
		}
		expect(onEvent).not.toHaveBeenCalled();
	});

	it("answers non-blocking events immediately and forwards to store", async () => {
		const { onEvent, post } = await start();
		const res = await post("/hook/PreToolUse", payload({ tool_name: "Bash" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Bash" }));
	});

	it("takes the event name from the URL", async () => {
		const { onEvent, post } = await start();
		await post("/hook/Stop", payload({ hook_event_name: "PreToolUse" }));
		expect(onEvent.mock.calls[0][0].hook_event_name).toBe("Stop");
	});

	it("holds PermissionRequest until approve", async () => {
		const { onEvent, approvals, post } = await start();
		approvals.onChange(() => approvals.approve());
		const res = await post("/hook/PermissionRequest", payload({ tool_name: "Bash", tool_input: { command: "npm test" } }));
		expect(await res.json()).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
		expect(onEvent).toHaveBeenCalledOnce();
	});

	it("answers AskUserQuestion permission requests immediately without queueing", async () => {
		const { onEvent, approvals, post } = await start();
		const res = await post("/hook/PermissionRequest", payload({ tool_name: "AskUserQuestion", tool_input: {} }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
		expect(approvals.count).toBe(0);
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion" }));
	});

	it("client abort cancels pending request", async () => {
		const { approvals, post } = await start();
		const settled = new Promise<string>((resolve) => approvals.onSettled(resolve));
		const controller = new AbortController();
		const pending = post("/hook/PermissionRequest", payload({ tool_name: "Bash", tool_input: {} }), {}, controller.signal).catch(() => "aborted");
		await vi.waitFor(() => expect(approvals.count).toBe(1));
		controller.abort();
		expect(await pending).toBe("aborted");
		expect(await settled).toBe("s1");
		expect(approvals.count).toBe(0);
	});

	it("binds to loopback only", async () => {
		await start();
		expect(server?.address()).toBe("127.0.0.1");
	});

	it("port in use does not throw", async () => {
		const blocker = createServer();
		await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
		const port = (blocker.address() as { port: number }).port;
		const log = vi.fn();
		server = createHookServer({ onEvent: vi.fn(), approvals: new PendingApprovals(), log });
		expect(await server.listen(port)).toBe(false);
		expect(log).toHaveBeenCalledWith(expect.stringContaining(String(port)));
		await new Promise((resolve) => blocker.close(resolve));
	});
});
