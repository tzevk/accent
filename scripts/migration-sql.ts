import type { MySql2Database } from 'drizzle-orm/mysql2';
import { sql, type SQL, type SQLChunk } from 'drizzle-orm';
import type { FieldPacket, RowDataPacket } from 'mysql2/promise';

export type MigrationDb = Pick<
	MySql2Database<Record<string, never>>,
	'execute'
>;

function buildMigrationSql(text: string, bindings: readonly unknown[]): SQL {
	const chunks: SQLChunk[] = [];
	let segmentStart = 0;
	let bindingIndex = 0;
	let index = 0;

	while (index < text.length) {
		const character = text[index];

		if (character === "'" || character === '"' || character === '`') {
			const quote = character;
			index += 1;
			while (index < text.length) {
				if (text[index] === '\\') {
					index += 2;
					continue;
				}
				if (text[index] !== quote) {
					index += 1;
					continue;
				}
				if (text[index + 1] === quote) {
					index += 2;
					continue;
				}
				index += 1;
				break;
			}
			continue;
		}

		if (character === '#') {
			index += 1;
			while (
				index < text.length &&
				text[index] !== '\n' &&
				text[index] !== '\r'
			) {
				index += 1;
			}
			continue;
		}

		if (
			character === '-' &&
			text[index + 1] === '-' &&
			(index + 2 === text.length || /\s/.test(text[index + 2]!))
		) {
			index += 2;
			while (
				index < text.length &&
				text[index] !== '\n' &&
				text[index] !== '\r'
			) {
				index += 1;
			}
			continue;
		}

		if (character === '/' && text[index + 1] === '*') {
			const commentEnd = text.indexOf('*/', index + 2);
			index = commentEnd === -1 ? text.length : commentEnd + 2;
			continue;
		}

		if (character !== '?') {
			index += 1;
			continue;
		}

		const identifier = text[index + 1] === '?';
		if (bindingIndex >= bindings.length) {
			throw new Error(
				`Migration SQL is missing a binding for its ${identifier ? 'identifier' : 'value'} placeholder at position ${index}.`
			);
		}

		const binding = bindings[bindingIndex];
		if (identifier && typeof binding !== 'string') {
			throw new Error(
				`Migration SQL identifier binding at position ${index} must be a string.`
			);
		}

		chunks.push(sql.raw(text.slice(segmentStart, index)));
		chunks.push(
			identifier ? sql.identifier(binding as string) : sql.param(binding)
		);
		bindingIndex += 1;
		index += identifier ? 2 : 1;
		segmentStart = index;
	}

	if (segmentStart < text.length) {
		chunks.push(sql.raw(text.slice(segmentStart)));
	}
	if (bindingIndex !== bindings.length) {
		throw new Error(
			`Migration SQL has ${bindings.length - bindingIndex} unused binding(s).`
		);
	}

	return sql.join(chunks);
}

export async function executeMigrationSql<TRow = RowDataPacket>(
	db: MigrationDb,
	text: string,
	params?: readonly unknown[]
): Promise<[TRow[], FieldPacket[]]> {
	const bindings = params ?? [];
	const query =
		bindings.length === 0 && !text.includes('?')
			? sql.raw(text)
			: buildMigrationSql(text, bindings);
	const result = await db.execute(query);
	return result as unknown as [TRow[], FieldPacket[]];
}
