export function latestCustomState<T>(
	entries: readonly unknown[],
	customType: string,
	isState: (value: unknown) => value is T,
): T | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			typeof entry !== "object" ||
			entry === null ||
			Array.isArray(entry) ||
			(entry as { type?: unknown }).type !== "custom" ||
			(entry as { customType?: unknown }).customType !== customType
		)
			continue;
		const data = (entry as { data?: unknown }).data;
		if (isState(data)) return data;
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
