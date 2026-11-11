/**
 * @file Read-only Live Update websocket client (ws://<director>/api/session/liveupdate).
 *
 * This client only ever sends `subscribe` and `unsubscribe` messages. It has no code path for `set`, so the module
 * cannot change anything in Designer through it. The expressions it subscribes are fixed in expressions.js; users
 * cannot enter their own.
 *
 * Protocol (verified on Designer r34):
 *   • {subscribe:{object, properties, configuration:{updateFrequencyMs}}}
 *     → {subscriptions:[{id,objectPath,propertyPath}]}, then {valuesChanged:[{id,value,…}]} on change
 *   • per-property errors arrive as value:{errorType,message}; a refused object as a top-level {error}
 *   • Designer rejects several subscribe frames sent back-to-back ("Invalid JSON") → one at a time
 *   • a connect attempt during Designer's startup can hang without handshake → connect timeout
 *
 * Groups: `setGroups([{tag, objectPath, props:{key: expression}, updateMs?}])` keeps the subscriptions in sync.
 * Emits: 'open', 'close' (reason), 'update' ({tag, objectPath, values:{key:value}}), 'error' (message),
 * 'refused' (objectPath).
 */
const { EventEmitter } = require('node:events')

const RETRY_MS = [1000, 2000, 5000, 10000]
const CONNECT_TIMEOUT_MS = 5000
const RESUBSCRIBE_MS = [1000, 2000, 5000]

class LiveUpdate extends EventEmitter {
	/**
	 * @param {{host:string, port?:number, updateMs?:number}} opts
	 */
	constructor(opts) {
		super()
		this.host = String(opts.host || '').trim()
		this.port = Number(opts.port) || 80
		this.updateMs = Math.max(10, Number(opts.updateMs) || 100)
		/** @type {WebSocket|null} */
		this.ws = null
		/** @type {Map<string, {tag:string, objectPath:string, props:Record<string,string>, updateMs?:number}>} */
		this.groups = new Map()
		/** @type {Set<string>} group ids subscribed on the open socket */
		this.subscribedGroups = new Set()
		/** @type {Map<string, {tag:string, key:string, objectPath:string}>} objectPath|propertyPath → info */
		this.pending = new Map()
		/** @type {Map<number, {tag:string, key:string, objectPath:string}>} subscription id → info */
		this.subs = new Map()
		this.stopped = true
		this.retries = 0
		this.retryTimer = null
		this.connectTimer = null
		this.connected = false
		this.queue = []
		this.inflight = null
		/** @type {Map<string, {timer: ReturnType<typeof setTimeout>|null, count: number}>} */
		this.refused = new Map()
	}

	get url() {
		const hostPort = this.port === 80 ? this.host : `${this.host}:${this.port}`
		return `ws://${hostPort}/api/session/liveupdate`
	}

	start() {
		this.stopped = false
		if (!this.ws) this.open()
		else this.syncSubscriptions()
	}

	stop() {
		this.stopped = true
		this.queue = []
		if (this.inflight) clearTimeout(this.inflight)
		this.inflight = null
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		if (this.connectTimer) clearTimeout(this.connectTimer)
		this.connectTimer = null
		this.clearRefused()
		const ws = this.ws
		this.ws = null
		this.subscribedGroups.clear()
		this.subs.clear()
		this.pending.clear()
		this.connected = false
		if (ws) {
			try {
				ws.close()
			} catch {
				// ignore
			}
		}
	}

	/**
	 * Replaces the wanted subscriptions. Unchanged groups keep their subscription.
	 * @param {{tag:string, objectPath:string, props:Record<string,string>, updateMs?:number}[]} groups
	 */
	setGroups(groups) {
		const next = new Map()
		for (const g of groups) next.set(LiveUpdate.groupId(g), g)
		const gone = []
		for (const [id, g] of this.groups) {
			const n = next.get(id)
			if (n && LiveUpdate.sameGroup(n, g)) continue
			for (const [subId, info] of this.subs)
				if (info.tag === g.tag && info.objectPath === g.objectPath) gone.push(subId)
			this.subscribedGroups.delete(id)
			for (const [k, info] of this.pending)
				if (info.tag === g.tag && info.objectPath === g.objectPath) this.pending.delete(k)
		}
		if (gone.length) this.sendNow({ unsubscribe: { ids: gone } })
		for (const subId of gone) this.subs.delete(subId)
		this.groups = next
		if (this.stopped) return
		if (!this.ws) this.open()
		else this.syncSubscriptions()
	}

	/** @param {{tag:string, objectPath:string}} g */
	static groupId(g) {
		return `${g.tag}|${g.objectPath}`
	}

	static sameGroup(a, b) {
		return (
			a.objectPath === b.objectPath &&
			(a.updateMs || 0) === (b.updateMs || 0) &&
			JSON.stringify(a.props) === JSON.stringify(b.props)
		)
	}

	/** Sends a frame right away (unsubscribe); errors are ignored. */
	sendNow(msg) {
		const ws = this.ws
		if (!ws || ws.readyState !== 1) return
		try {
			ws.send(JSON.stringify(msg))
		} catch {
			// ignore
		}
	}

	/** Queues a subscribe frame; the next one goes out after the reply (or 250 ms). */
	sendQueued(msg) {
		this.queue.push(msg)
		this.pump()
	}

	pump() {
		const ws = this.ws
		if (this.inflight || !ws || ws.readyState !== 1 || this.queue.length === 0) return
		const msg = this.queue.shift()
		try {
			ws.send(JSON.stringify(msg))
		} catch (e) {
			this.emit('error', `Live Update send: ${e?.message || e}`)
			return
		}
		this.inflight = setTimeout(() => {
			this.inflight = null
			this.pump()
		}, 250)
	}

	replied() {
		if (this.inflight) clearTimeout(this.inflight)
		this.inflight = null
		this.pump()
	}

	open() {
		if (this.stopped || this.ws) return
		if (typeof WebSocket !== 'function') {
			this.emit('error', 'WebSocket is not available in this Node runtime')
			return
		}
		let ws
		try {
			ws = new WebSocket(this.url)
		} catch (e) {
			this.emit('error', `Live Update: ${e?.message || e}`)
			this.scheduleRetry()
			return
		}
		this.ws = ws
		this.subscribedGroups.clear()
		this.subs.clear()
		this.pending.clear()
		if (this.connectTimer) clearTimeout(this.connectTimer)
		this.connectTimer = setTimeout(() => {
			this.connectTimer = null
			if (this.ws !== ws || ws.readyState === 1) return
			this.emit('error', `Live Update: no answer within ${CONNECT_TIMEOUT_MS} ms – retrying`)
			this.dropSocket(ws, 'connect timeout')
		}, CONNECT_TIMEOUT_MS)
		ws.onopen = () => {
			if (this.ws !== ws) return
			if (this.connectTimer) clearTimeout(this.connectTimer)
			this.connectTimer = null
			this.connected = true
			this.retries = 0
			this.emit('open')
			this.syncSubscriptions()
		}
		ws.onmessage = (ev) => {
			if (this.ws !== ws) return
			this.handleMessage(String(ev.data))
		}
		ws.onerror = () => {
			// onclose follows
		}
		ws.onclose = (ev) => {
			if (this.ws !== ws) return
			this.dropSocket(ws, ev?.reason || `code ${ev?.code ?? '?'}`)
		}
	}

	/**
	 * @param {WebSocket} ws
	 * @param {string} reason
	 */
	dropSocket(ws, reason) {
		if (this.ws !== ws) return
		this.ws = null
		if (this.connectTimer) clearTimeout(this.connectTimer)
		this.connectTimer = null
		this.queue = []
		if (this.inflight) clearTimeout(this.inflight)
		this.inflight = null
		this.clearRefused()
		const wasConnected = this.connected
		this.connected = false
		this.subscribedGroups.clear()
		this.subs.clear()
		this.pending.clear()
		try {
			ws.close()
		} catch {
			// ignore
		}
		if (wasConnected || reason === 'connect timeout') this.emit('close', reason)
		this.scheduleRetry()
	}

	scheduleRetry() {
		if (this.stopped || this.retryTimer) return
		const delay = RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)]
		this.retries++
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			this.open()
		}, delay)
	}

	clearRefused() {
		for (const r of this.refused.values()) if (r.timer) clearTimeout(r.timer)
		this.refused.clear()
	}

	/**
	 * Designer refused a group's object (not there yet, e.g. while a project loads): retry later.
	 * @param {string} objectPath
	 */
	retryRefused(objectPath) {
		for (const [id, g] of this.groups) {
			if (g.objectPath !== objectPath || !this.subscribedGroups.has(id)) continue
			this.subscribedGroups.delete(id)
			for (const [k, info] of this.pending) if (info.objectPath === objectPath) this.pending.delete(k)
			const r = this.refused.get(id) || { timer: null, count: 0 }
			if (r.timer) clearTimeout(r.timer)
			const delay = RESUBSCRIBE_MS[Math.min(r.count, RESUBSCRIBE_MS.length - 1)]
			r.count++
			r.timer = setTimeout(() => {
				r.timer = null
				this.syncSubscriptions()
			}, delay)
			this.refused.set(id, r)
			if (r.count === 1) this.emit('refused', objectPath)
		}
	}

	/** Subscribes every wanted group that is not subscribed yet on the open socket. */
	syncSubscriptions() {
		const ws = this.ws
		if (!ws || ws.readyState !== 1) return
		for (const [id, g] of this.groups) {
			if (this.subscribedGroups.has(id)) continue
			this.subscribedGroups.add(id)
			for (const [key, expr] of Object.entries(g.props))
				this.pending.set(`${g.objectPath}|${expr}`, { tag: g.tag, key, objectPath: g.objectPath })
			this.sendQueued({
				subscribe: {
					object: g.objectPath,
					properties: Object.values(g.props),
					configuration: { updateFrequencyMs: g.updateMs || this.updateMs },
				},
			})
		}
	}

	/** @param {string} data */
	handleMessage(data) {
		let msg
		try {
			msg = JSON.parse(data)
		} catch {
			return
		}
		if (msg.error) {
			this.replied()
			this.emit('error', `Live Update: ${msg.error}`)
			const m = /Unable to subscribe to (.+?) \/ (.+?) - /.exec(String(msg.error))
			if (m && this.pending.has(`${m[1]}|${m[2]}`) && /Unable to find object/i.test(String(msg.error)))
				this.retryRefused(m[1])
			return
		}
		if (Array.isArray(msg.subscriptions)) {
			this.replied()
			for (const s of msg.subscriptions) {
				const k = `${s.objectPath}|${s.propertyPath}`
				const info = this.pending.get(k)
				if (!info) continue
				this.pending.delete(k)
				this.subs.set(Number(s.id), info)
				const gid = `${info.tag}|${info.objectPath}`
				const r = this.refused.get(gid)
				if (r) {
					if (r.timer) clearTimeout(r.timer)
					this.refused.delete(gid)
				}
			}
			return
		}
		if (!Array.isArray(msg.valuesChanged)) return
		/** @type {Map<string, {tag:string, objectPath:string, values:Record<string, unknown>}>} */
		const perGroup = new Map()
		for (const v of msg.valuesChanged) {
			const sub = this.subs.get(Number(v.id))
			if (!sub) continue
			if (v.value && typeof v.value === 'object' && !Array.isArray(v.value) && 'errorType' in v.value) {
				this.emit('error', `Live Update ${sub.objectPath} ${sub.key}: ${v.value.message || v.value.errorType}`)
				continue
			}
			const gk = `${sub.tag}|${sub.objectPath}`
			let g = perGroup.get(gk)
			if (!g) {
				g = { tag: sub.tag, objectPath: sub.objectPath, values: {} }
				perGroup.set(gk, g)
			}
			g.values[sub.key] = v.value
		}
		for (const g of perGroup.values()) this.emit('update', g)
	}
}

module.exports = { LiveUpdate }
