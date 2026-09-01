const STRING_LITERAL_OBJECT = "object";
const STRING_LITERAL_CUSTOM = "custom";

export function latestCustomState<T>(
	entries: readonly unknown[],
	customType: string,
	isState: (value: unknown) => value is T,
): T | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		const isObject = typeof entry === STRING_LITERAL_OBJECT;
		if (!isObject) continue;
		if (entry === null) continue;
		if (Array.isArray(entry)) continue;
		const record = entry as { type?: unknown; customType?: unknown };
		const isCustomStateEntry = record.type === STRING_LITERAL_CUSTOM;
		if (!isCustomStateEntry) continue;
		const hasMatchingType = record.customType === customType;
		if (!hasMatchingType) continue;
		const data = (entry as { data?: unknown }).data;
		const isValidState = isState(data);
		if (isValidState) return data;
	}
	return null;
}

export function appendCustomState<T>(
	appendEntry: (customType: string, data: T) => void,
	customType: string,
	state: T,
): void {
	appendEntry(customType, state);
}
