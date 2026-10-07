import streamDeck from "@elgato/streamdeck";

import { DecisionKeys } from "./actions/decision-action.js";
import { KeyAdapter } from "./actions/key-adapter.js";
import { SessionStore } from "./domain/session-store.js";
import type { DecisionKind } from "./render/decision-key.js";
import { HOOK_PORT } from "./server/hook-contract.js";
import { createHookServer } from "./server/hook-server.js";
import { PendingApprovals } from "./server/pending-approvals.js";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("ClaudeDeck");

const store = new SessionStore(Date.now);
const approvals = new PendingApprovals();
approvals.onSettled((sessionId) => store.approvalDecided(sessionId));
setInterval(() => store.tick(), 30_000);

let online = false;
const decisionKeys = (["allow", "always", "deny"] as DecisionKind[]).map((kind) => {
	const keys = new DecisionKeys(kind, approvals, () => online);
	streamDeck.actions.registerAction(new KeyAdapter(`com.claudedeck.streamdeck.${kind}`, keys));
	return keys;
});

const server = createHookServer({ onEvent: (event) => store.handle(event), approvals, log: (message) => log.error(message) });
server.listen(HOOK_PORT).then((ok) => {
	online = ok;
	if (ok) log.info(`hook server listening on 127.0.0.1:${HOOK_PORT}`);
	for (const keys of decisionKeys) keys.renderAll();
});

streamDeck.connect();
