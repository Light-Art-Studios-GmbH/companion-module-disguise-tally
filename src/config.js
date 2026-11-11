/**
 * @file Connection configuration fields.
 *
 * Config keys:
 *   host           Director IP or hostname (optionally ":port", default 80)
 *   host2          optional backup machine (understudy); used while the Director does not answer
 *   inputs         one input per line: "Resource name = Label" (label optional); empty = every live input found
 *   transports     transports to watch (comma separated), empty = all
 *   previewSeconds a layer starting within this many seconds gives PVW (0 = no preview)
 */

/**
 * @returns {import('@companion-module/base').SomeCompanionConfigField[]}
 */
function getConfigFields() {
	return [
		{
			id: 'info',
			type: 'static-text',
			label: 'Read-only tally',
			width: 12,
			value:
				'Shows which live inputs are on air (PGM), coming up (PVW) or off on the disguise timeline. ' +
				'This module only reads from Designer; it has no actions and cannot control the server.',
		},
		{
			id: 'host',
			type: 'textinput',
			label: 'Director IP',
			width: 6,
			default: '',
		},
		{
			id: 'host2',
			type: 'textinput',
			label: 'Backup IP (optional)',
			width: 6,
			default: '',
			tooltip: 'Used while the Director does not answer; the module goes back to the Director when it answers again.',
		},
		{
			id: 'inputs',
			type: 'textinput',
			label: 'Inputs (empty = every live input in the project; else one per line: resource name = label)',
			width: 12,
			default: '',
			multiline: true,
			tooltip:
				'Empty: every live input of the project, with its Designer name.\n' +
				'Or list them yourself, e.g.\nvideoin_1.mov = Camera 1\nNDI Stage = Wide shot\n' +
				'Names are compared without case, spaces and file extension ("Video in 1" = "videoin_1.mov").',
		},
		{
			id: 'transports',
			type: 'textinput',
			label: 'Transports to watch (comma separated, empty = all)',
			width: 6,
			default: '',
			tooltip: 'The variable "transports" lists every transport of the project to copy names from.',
		},
		{
			id: 'previewSeconds',
			type: 'number',
			label: 'Preview: layer starts within (seconds, 0 = off)',
			width: 6,
			default: 10,
			min: 0,
			max: 3600,
		},
	]
}

module.exports = { getConfigFields }
