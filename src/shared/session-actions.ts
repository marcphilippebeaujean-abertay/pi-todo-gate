export interface SessionActionStarted<T> {
	started: true;
	value: T;
	currentAfterAction: boolean;
}

export interface SessionActionSkipped {
	started: false;
	currentAfterAction: false;
}

export type SessionActionResult<T> =
	| SessionActionStarted<T>
	| SessionActionSkipped;

export async function runSessionAction<T>(
	isCurrent: () => boolean,
	action: () => Promise<T> | T,
	notifySkipped: () => Promise<void> | void,
): Promise<SessionActionResult<T>> {
	const isCurrentBeforeAction = isCurrent();
	if (!isCurrentBeforeAction) {
		await notifySkipped();
		return { started: false, currentAfterAction: false };
	}
	const value = await action();
	return {
		started: true,
		value,
		currentAfterAction: isCurrent(),
	};
}
