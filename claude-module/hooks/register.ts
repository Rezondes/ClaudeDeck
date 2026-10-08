import type { EngineInterface, Register, TurnCompleteInput } from 'claude-code'

// Must match MODULE_BASE_URL in src/server/hook-contract.ts.
const BASE = 'http://127.0.0.1:37419/module'
/** Usage report interval besides turn.complete, so limits refresh while idle (PLAN.md, Package 29). */
const USAGE_REPORT_MS = 60_000

/**
 * Best effort and never awaited by a hook: without ClaudeDeck running the session goes on silently (PLAN.md, Package 23 AC2).
 * Every $ call sits inside the try, so nothing throws into the turn.
 */
async function post($: EngineInterface, event: string, fields: () => Promise<object>): Promise<void> {
	try {
		const body = JSON.stringify({ sessionId: await $.session.id(), ...(await fields()) })
		await $.http.fetch(`${BASE}/${event}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
	} catch {}
}

/** Aborts the running turn when ClaudeDeck queued an abort for exactly that turn (PLAN.md, Package 27); never throws. */
async function pollCommands($: EngineInterface, runningTurnId: () => string | undefined): Promise<void> {
	try {
		const { ok, text } = await $.http.fetch(`${BASE}/commands?session=${encodeURIComponent(await $.session.id())}`)
		if (!ok) return
		for (const command of JSON.parse(text).commands) {
			// A command for another turn is stale: that turn already ended.
			if (command?.kind === 'abort' && command.turnId === runningTurnId()) await $.turn.abort({ turnId: command.turnId })
		}
	} catch {}
}

type Outcome = 'completed' | 'aborted' | 'failed'

/** How a turn ended (PLAN.md, Package 30): reason "error" is an API error, a refusal counts as an answered turn. */
const outcomeOf = (e: TurnCompleteInput): Outcome => (e.isAborted ? 'aborted' : e.reason === 'error' ? 'failed' : 'completed')

/** Posts the usage; periodic reports (Package 29) carry periodic: true and no outcome, so the store keeps the running turn and state. */
function postUsage($: EngineInterface, end: { periodic: true } | { outcome: Outcome }): Promise<void> {
	return post($, 'usage', async () => {
		const { context, rateLimits } = await $.session.usage()
		return { context, rateLimits, ...end }
	})
}

export const register: Register = on => {
	let runningTurnId: string | undefined
	let polling: { cancel(): void } | undefined
	let reporting: { cancel(): void } | undefined
	let busy = false
	let reportBusy = false

	on('session.start', async ($, e, next) => {
		const result = await next(e)
		void post($, 'session-start', async () => ({ cwd: result.cwd }))
		try {
			reporting?.cancel()
			reporting = $.clock.every(USAGE_REPORT_MS, () => {
				if (reportBusy) return
				reportBusy = true
				void postUsage($, { periodic: true }).finally(() => (reportBusy = false))
			})
		} catch {}
		try {
			polling?.cancel()
			// At most one poll in flight, so a slow ClaudeDeck never stacks requests.
			polling = $.clock.every(1000, () => {
				if (busy || !runningTurnId) return // nothing to interrupt: no traffic while idle
				busy = true
				void pollCommands($, () => runningTurnId).finally(() => (busy = false))
			})
		} catch {}
		return result
	})

	on('turn.start', async ($, e, next) => {
		runningTurnId = e.turnId
		void post($, 'turn-start', async () => ({ turnId: e.turnId }))
		return next(e)
	})

	on('turn.complete', async ($, e, next) => {
		if (runningTurnId === e.turnId) runningTurnId = undefined
		const result = await next(e)
		void postUsage($, { outcome: outcomeOf(e) })
		return result
	})
}
