/**
 * @file Config/feedback upgrade scripts. Append new scripts at the end and never remove existing ones –
 * Companion stores the index of the last script that ran.
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<any>[]}
 */
const UpgradeScripts = []

module.exports = { UpgradeScripts }
