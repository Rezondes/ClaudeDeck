import type { EngineInterface, Register } from 'claude-code'

// Must match MODULE_BASE_URL in src/server/hook-contract.ts.
const BASE = 'http://127.0.0.1:37419/module'

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

export const register: Register = on => {
	on('session.start', async ($, e, next) => {
		const result = await next(e)
		void post($, 'session-start', async () => ({ cwd: result.cwd }))
		return result
	})

	on('turn.start', async ($, e, next) => {
		void post($, 'turn-start', async () => ({ turnId: e.turnId }))
		return next(e)
	})

	on('turn.complete', async ($, e, next) => {
		const result = await next(e)
		void post($, 'usage', async () => {
			const { context, rateLimits } = await $.session.usage()
			return { context, rateLimits }
		})
		return result
	})
}
