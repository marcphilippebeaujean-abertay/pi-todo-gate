export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}
