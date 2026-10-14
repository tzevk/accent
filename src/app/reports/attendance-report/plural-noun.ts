/**
 * The noun for a count, in one place.
 *
 * The cell drill-down and the unmapped-code strip each build a sentence around
 * a count ("3 Punches from 2 codes"). The rule used to sit at every site, so a
 * noun could drift between two sentences that a reader sees together.
 */

/**
 * Singular noun for one item, plural for every other count, zero included.
 *
 * `pluralNoun(1, 'punch', 'punches')` returns `'punch'`.
 * `pluralNoun(0, 'punch', 'punches')` returns `'punches'`.
 */
export function pluralNoun(
	count: number,
	singular: string,
	plural: string
): string {
	return count === 1 ? singular : plural;
}
