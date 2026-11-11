/**
 * @file Minimal REST client for the disguise session API – GET requests only (transport list, reachability).
 * There is deliberately no POST in this module.
 */

class SessionApi {
	/**
	 * @param {{host:string, port?:number, timeoutMs?:number}} opts
	 */
	constructor(opts) {
		this.host = String(opts.host || '').trim()
		this.port = Number(opts.port) || 80
		this.timeoutMs = Number(opts.timeoutMs) || 4000
	}

	get base() {
		const hostPort = this.port === 80 ? this.host : `${this.host}:${this.port}`
		return `http://${hostPort}/api/session`
	}

	/**
	 * @param {string} path e.g. /transport/transports
	 * @returns {Promise<any>}
	 */
	async get(path) {
		const ctrl = new AbortController()
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
		try {
			const res = await fetch(`${this.base}${path}`, { method: 'GET', signal: ctrl.signal })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const code = Number(body?.status?.code ?? 0)
			if (code !== 0) throw new Error(String(body?.status?.message || `status code ${code}`))
			return body
		} catch (e) {
			if (e?.name === 'AbortError') throw new Error(`no answer within ${this.timeoutMs} ms`, { cause: e })
			throw e
		} finally {
			clearTimeout(timer)
		}
	}

	/** @returns {Promise<{uid:string, name:string, engaged:boolean}[]>} real transports (multitransports have no Live Update object) */
	async transports() {
		const body = await this.get('/transport/transports')
		const list = Array.isArray(body?.transports) ? body.transports : Array.isArray(body?.result) ? body.result : []
		return list.map((t) => ({
			uid: String(t.uid ?? ''),
			name: String(t.name ?? ''),
			engaged: t.engaged !== false,
		}))
	}
}

module.exports = { SessionApi }
