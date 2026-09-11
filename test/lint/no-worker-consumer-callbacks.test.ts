import { describe, expect, it } from "vitest";
import { lintFixture } from "./helpers.ts";

const RULE_ID = "no-worker-consumer-callbacks";
const SOURCE = `
interface ClaimWorkerRequest {
	onClaimComplete: (result: string) => void;
	onFailure: (message: string) => void;
	events: HerdrEvents;
}
`;
const CLEAN_SOURCE = `
interface ClaimWorkerRequest {
	events: HerdrEvents;
}
`;

describe(RULE_ID, () => {
	it("rejects consumer callback fields in worker request contracts", async () => {
		const diagnostics = (await lintFixture(SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toHaveLength(2);
	});

	it("allows event publishers in worker request contracts", async () => {
		const diagnostics = (await lintFixture(CLEAN_SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toEqual([]);
	});
});
