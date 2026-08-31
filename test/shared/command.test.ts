import { describe, expect, it } from "vitest";
import { spawnExec } from "../../src/shared/command.ts";

describe("spawnExec", () => {
	it("closes stdin for non-interactive commands", async () => {
		const result = await spawnExec(
			process.execPath,
			[
				"-e",
				"process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('done'))",
			],
			{ timeout: 1_000 },
		);

		expect(result).toMatchObject({ code: 0, stdout: "done", killed: false });
	});
});
