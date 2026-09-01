import type { ActiveSession } from "./extension-types.ts";

export function enqueueSessionOperation<T>(
	session: ActiveSession,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = session.operationQueue.catch(() => undefined);
	const current = previous.then(operation);
	session.operationQueue = current.then(
		() => undefined,
		() => undefined,
	);
	return current;
}
