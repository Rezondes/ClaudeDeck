import streamDeck from "@elgato/streamdeck";

import { SessionStore } from "./domain/session-store.js";
import { HOOK_PORT } from "./server/hook-contract.js";
import { createHookServer } from "./server/hook-server.js";
import { PendingApprovals } from "./server/pending-approvals.js";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("ClaudeDeck");

const store = new SessionStore(Date.now);
const approvals = new PendingApprovals();
approvals.onSettled((sessionId) => store.approvalDecided(sessionId));
setInterval(() => store.tick(), 30_000);

const server = createHookServer({ onEvent: (event) => store.handle(event), approvals, log: (message) => log.error(message) });
const online = server.listen(HOOK_PORT);

streamDeck.connect();
online.then((ok) => ok && log.info(`hook server listening on 127.0.0.1:${HOOK_PORT}`));
