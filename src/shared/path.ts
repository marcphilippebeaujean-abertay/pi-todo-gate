import { resolve } from "node:path";

export function normalizedPath(path: string): string {
	return resolve(path);
}

export function isPathAtOrBelow(path: string, ancestor: string): boolean {
	const target = normalizedPath(path);
	const parent = normalizedPath(ancestor);
	const hasTrailingSeparator = parent.endsWith("/") || parent.endsWith("\\");
	const prefix = hasTrailingSeparator ? parent : `${parent}/`;
	return target === parent || target.startsWith(prefix);
}
