import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { HookEvent, ModuleEvent } from "../domain/hook-event.js";
import type { CommandQueue } from "./command-queue.js";
import { HOOK_EVENTS, MODULE_EVENTS, type HookEventName, type ModuleEventName } from "./hook-contract.js";
import type { PendingApprovals, PermissionRequestEvent } from "./pending-approvals.js";

const MAX_BODY_BYTES = 1024 * 1024;

export interface HookServerDeps {
	/** Every accepted event, PermissionRequest included (before it is queued). */
	onEvent: (event: HookEvent) => void;
	/** Every accepted POST /module/<event> from the plugin module. */
	onModuleEvent: (event: ModuleEvent) => void;
	approvals: PendingApprovals;
	/** Served once each by GET /module/commands?session=<id>. */
	commands: CommandQueue;
	log: (message: string) => void;
}

export interface HookServer {
	/** Resolves false (and logs) when the port cannot be bound, e.g. already in use. */
	listen(port: number): Promise<boolean>;
	close(): Promise<void>;
	port(): number | undefined;
	address(): string | undefined;
}

/** Local HTTP endpoint for the hooks in claude-plugin/hooks/hooks.json and the module in claude-module/. Loopback only. */
export function createHookServer({ onEvent, onModuleEvent, approvals, commands, log }: HookServerDeps): HookServer {
	const server = createServer((req, res) => {
		handle(req, res).catch((error) => {
			log(`hook request failed: ${error}`);
			send(res, 500, {});
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// Browsers always send Origin and need a CORS preflight for JSON: reject both (PLAN.md, Package 4 AC2b).
		if (req.method === "OPTIONS") return send(res, 405, {});
		if (req.headers.origin !== undefined) return send(res, 403, {});
		// Browsers always send Sec-Fetch-Site (also on no-cors GETs without Origin); Claude Code never does.
		if (req.headers["sec-fetch-site"] !== undefined) return send(res, 403, {});
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/module/commands") {
			if (req.method !== "GET") return send(res, 405, {});
			const session = url.searchParams.get("session");
			if (!session || session.length > 100) return send(res, 400, {});
			return send(res, 200, { commands: commands.take(session) });
		}
		const name = req.url?.match(/^\/hook\/(\w+)$/)?.[1] as HookEventName | undefined;
		const moduleName = req.url?.match(/^\/module\/([\w-]+)$/)?.[1] as ModuleEventName | undefined;
		const known = (name && HOOK_EVENTS.includes(name)) || (moduleName && MODULE_EVENTS.includes(moduleName));
		if (req.method !== "POST" || !known) return send(res, 404, {});
		if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) return send(res, 415, {});

		const body = await readBody(req);
		if (body === undefined) return send(res, 413, {});
		let fields: Record<string, unknown>;
		try {
			fields = { ...JSON.parse(body) };
		} catch {
			return send(res, 400, {});
		}

		if (moduleName) {
			if (typeof fields.sessionId !== "string") return send(res, 400, {});
			onModuleEvent({ ...fields, name: moduleName } as unknown as ModuleEvent);
			return send(res, 200, {});
		}

		const event = { ...fields, hook_event_name: name } as unknown as HookEvent;
		if (typeof event.session_id !== "string" || typeof event.cwd !== "string") return send(res, 400, {});

		if (name === "PermissionRequest") {
			if (typeof event.tool_name !== "string") return send(res, 400, {});
			if (res.destroyed) return; // client already gone: nothing to approve, keep the store's count balanced
		}

		onEvent(event);
		// A question cannot be answered with Allow/Deny: let Claude ask it as usual (PLAN.md, Package 21).
		if (name !== "PermissionRequest" || event.tool_name === "AskUserQuestion") return send(res, 200, {});

		const id = approvals.add(event as PermissionRequestEvent, (response) => send(res, 200, response));
		res.on("close", () => {
			if (!res.writableEnded) approvals.cancel(id);
		});
	}

	return {
		listen: (port) =>
			new Promise((resolve) => {
				server.once("error", (error) => {
					log(`hook server cannot listen on 127.0.0.1:${port}: ${error.message}`);
					resolve(false);
				});
				server.listen(port, "127.0.0.1", () => resolve(true));
			}),
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
		port: () => {
			const address = server.address();
			return typeof address === "object" && address ? address.port : undefined;
		},
		address: () => {
			const address = server.address();
			return typeof address === "object" && address ? address.address : undefined;
		},
	};
}

/** The request body, or undefined when it exceeds MAX_BODY_BYTES (the rest is drained, not buffered). */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size <= MAX_BODY_BYTES) chunks.push(chunk);
	}
	return size > MAX_BODY_BYTES ? undefined : Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: object): void {
	if (res.writableEnded || res.destroyed) return;
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}
