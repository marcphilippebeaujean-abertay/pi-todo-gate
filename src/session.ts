const SUBAGENT_ENVIRONMENT = "PI_SUBAGENT_CHILD";
export function isSubagent(): boolean {
	return process.env[SUBAGENT_ENVIRONMENT] !== undefined;
}

export function withWorkerMarker(): NodeJS.ProcessEnv {
	return { ...process.env, [SUBAGENT_ENVIRONMENT]: "1" };
}
