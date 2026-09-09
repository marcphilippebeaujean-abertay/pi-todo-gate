const CUSTOM_ENTRY = "custom";
const HERDR_STATE_TYPE = "pi-todo-gate-herdr-state";
const RAN = "ran";
const OBJECT_TYPE = "object";

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObject = typeof value === OBJECT_TYPE;
	if (!isObject) return false;
	const isNull = value === null;
	if (isNull) return false;
	return !Array.isArray(value);
}

export function hasHerdrClaimRun(entries: readonly unknown[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		const isRecordEntry = isRecord(entry);
		if (!isRecordEntry) continue;
		const isHerdrState =
			entry.type === CUSTOM_ENTRY && entry.customType === HERDR_STATE_TYPE;
		if (!isHerdrState) continue;
		const data = entry.data;
		const hasRecordData = isRecord(data);
		if (!hasRecordData) continue;
		const hasRanFlag = data[RAN] === true;
		if (hasRanFlag) return true;
	}
	return false;
}
