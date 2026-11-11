/**
 * @file Preset buttons (Companion 5 "layered" buttons), same tile layout as the disguise-session module:
 *   header – small, muted: input number
 *   main   – large: label
 *   footer – small: tally state (PGM / PVW / OFF)
 * Buttons have no actions (read-only module). Feedbacks later in the list win, so program comes last.
 */
const { combineRgb } = require('@companion-module/base')

const WHITE = combineRgb(245, 245, 245)
const DARK = combineRgb(18, 18, 20)
const MUTED = combineRgb(150, 150, 156)
const RED = combineRgb(170, 20, 20)
const GREEN = combineRgb(22, 120, 48)

/** Companion expects overrides as {isExpression, value}. */
const ov = (value) => ({ isExpression: false, value })

/**
 * @param {{name:string, header:string, main:string, footer:string,
 *   feedbacks?:{feedbackId:string, options?:object, bg?:number}[]}} o
 */
function tile(o) {
	const elements = [
		{ id: 'bg', type: 'box', x: 0, y: 0, width: 100, height: 100, color: DARK, cornerRadius: 0 },
		{
			id: 'header',
			type: 'text',
			x: 3,
			y: 2,
			width: 94,
			height: 16,
			text: o.header,
			fontsize: 92,
			fontsizeAllowShrink: true,
			color: MUTED,
			halign: 'left',
			valign: 'center',
		},
		{
			id: 'main',
			type: 'text',
			x: 2,
			y: 19,
			width: 96,
			height: 58,
			text: o.main,
			fontsize: 56,
			fontsizeAllowShrink: true,
			weight: 'bold',
			font: 'companion-sans',
			color: WHITE,
			halign: 'center',
			valign: 'center',
		},
		{
			id: 'footer',
			type: 'text',
			x: 3,
			y: 80,
			width: 94,
			height: 17,
			text: o.footer,
			fontsize: 92,
			fontsizeAllowShrink: true,
			color: MUTED,
			halign: 'center',
			valign: 'center',
		},
	]
	const feedbacks = (o.feedbacks || []).map((f) => {
		const styleOverrides = []
		if (f.bg !== undefined) {
			styleOverrides.push({ elementId: 'bg', elementProperty: 'color', override: ov(f.bg) })
			styleOverrides.push({ elementId: 'header', elementProperty: 'color', override: ov(WHITE) })
			styleOverrides.push({ elementId: 'footer', elementProperty: 'color', override: ov(WHITE) })
		}
		return { feedbackId: f.feedbackId, options: f.options || {}, styleOverrides }
	})
	return { type: 'layered', name: o.name, elements, steps: [{ down: [], up: [] }], feedbacks }
}

/**
 * @param {import('./instance.js').TallyInstance} instance
 * @returns {{structure: any[], presets: Record<string, any>}}
 */
function getPresetDefinitions(instance) {
	const label = instance.label || 'd3-tally'
	const v = (name) => `$(${label}:${name})`
	/** @type {Record<string, any>} */
	const presets = {}
	const ids = []
	for (const i of instance.inputs) {
		const n = String(i.index)
		const id = `tally_${n}`
		presets[id] = tile({
			name: `Tally ${i.label}`,
			header: `IN ${n}`,
			main: v(`input_${n}_name`),
			footer: v(`input_${n}_state`),
			feedbacks: [
				{ feedbackId: 'preview', options: { input: n }, bg: GREEN },
				{ feedbackId: 'program', options: { input: n }, bg: RED },
			],
		})
		ids.push(id)
	}
	const structure = [
		{
			id: 'tally',
			name: 'Tally',
			definitions: [{ id: 'inputs', type: 'simple', name: 'Inputs', presets: ids }],
		},
	]
	return { structure, presets }
}

module.exports = { getPresetDefinitions }
