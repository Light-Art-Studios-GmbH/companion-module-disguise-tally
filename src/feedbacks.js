/**
 * @file Feedback definitions (boolean): PGM and PVW per input. The input option lists the inputs by number.
 */
const { combineRgb } = require('@companion-module/base')

const RED = combineRgb(200, 0, 0)
const GREEN = combineRgb(0, 150, 0)
const WHITE = combineRgb(255, 255, 255)

/**
 * @param {import('./instance.js').TallyInstance} instance
 * @returns {import('@companion-module/base').CompanionFeedbackDefinitions}
 */
function getFeedbackDefinitions(instance) {
	const choices = instance.inputs.map((i) => ({ id: String(i.index), label: `${i.index}: ${i.label}` }))
	const inputOption = {
		id: 'input',
		type: 'dropdown',
		label: 'Input',
		default: choices[0]?.id ?? '1',
		choices: choices.length ? choices : [{ id: '1', label: '1' }],
	}
	const state = (opt) => instance.tallyOf(Number(opt.input))

	return {
		program: {
			type: 'boolean',
			name: 'Input on air (PGM)',
			description: 'The input plays on a layer at the playhead of a watched transport',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [inputOption],
			callback: (fb) => state(fb.options) === 'program',
		},
		preview: {
			type: 'boolean',
			name: 'Input coming up (PVW)',
			description: 'The input is on a layer that starts within the preview time and is not on air yet',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [inputOption],
			callback: (fb) => state(fb.options) === 'preview',
		},
	}
}

module.exports = { getFeedbackDefinitions }
