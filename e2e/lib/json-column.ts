/**
 * The MySQL driver hands JSON columns back already parsed, so a
 * `CHECK (json_valid(...))` column read through the E2E pool is an
 * object on some driver versions and a JSON string on others. Read
 * either shape the same way instead of parsing an object.
 */
export function parseJsonColumn<T>(value: unknown): T {
	return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
