const OBJECT_TYPE = "object";
const CUSTOM_ENTRY_TYPE = "custom";

export function latestCustomState<T>(
	entries: readonly unknown[],
	customType: string,
	isState: (value: unknown) => value is T,
): T | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		const isObject = typeof entry === OBJECT_TYPE;
		if (!isObject) continue;
		if (entry === null) continue;
		if (Array.isArray(entry)) continue;
		const record = entry as { type?: unknown; customType?: unknown };
		const isCustomStateEntry = record.type === CUSTOM_ENTRY_TYPE;
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
