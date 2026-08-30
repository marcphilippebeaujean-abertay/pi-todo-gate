import { describe, expect, it } from "vitest";
import { firstUnmergedGithubPrUrl } from "../../src/pr/detection.ts";
import {
	isPrState,
	markRemindersDelivered,
	mergedUrls,
	recordMergedPr,
	removeMergedPr,
} from "../../src/pr/state.ts";

describe("isPrState", () => {
	it("accepts valid PR state and rejects malformed state", () => {
		expect(
			isPrState({
				prUrl: "https://github.com/o/r/pull/42",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/41",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
				],
				discoveryDisabled: true,
			}),
		).toBe(true);
		expect(isPrState({ prUrl: 42 })).toBe(false);
		expect(
			isPrState({
				mergedPrs: [{ prUrl: "https://github.com/o/r/pull/41" }],
			}),
		).toBe(false);
	});
});

describe("recordMergedPr", () => {
	it("records each merged PR and clears active PR", () => {
		const next = recordMergedPr(
			{ prUrl: "https://github.com/o/r/pull/42" },
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});

	it("refreshes an existing merged PR record without duplicating its URL", () => {
		const next = recordMergedPr(
			{
				prUrl: "https://github.com/o/r/pull/42",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
					{
						prUrl: "https://github.com/o/r/pull/41",
						detectedAt: "2026-08-28T00:00:00Z",
						reminderPending: false,
					},
				],
			},
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/41",
					detectedAt: "2026-08-28T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});

	it("appends second merged PR without duplicating existing URL records", () => {
		const next = recordMergedPr(
			{
				prUrl: "https://github.com/o/r/pull/43",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
				],
				discoveryDisabled: true,
			},
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-29T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});
});

describe("markRemindersDelivered", () => {
	it("marks all pending reminders delivered and preserves existing records", () => {
		expect(
			markRemindersDelivered({
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: true,
					},
					{
						prUrl: "https://github.com/o/r/pull/43",
						detectedAt: "2026-08-30T00:00:00Z",
						reminderPending: false,
					},
				],
			}),
		).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-29T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: false,
				},
			],
		});
	});
});

describe("removeMergedPr", () => {
	it("removes a merged PR URL so it can be reused explicitly", () => {
		expect(
			removeMergedPr(
				{
					mergedPrs: [
						{
							prUrl: "https://github.com/o/r/pull/42",
							detectedAt: "2026-08-29T00:00:00Z",
							reminderPending: false,
						},
						{
							prUrl: "https://github.com/o/r/pull/43",
							detectedAt: "2026-08-30T00:00:00Z",
							reminderPending: true,
						},
					],
				},
				"https://github.com/o/r/pull/42",
			),
		).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
		});
	});
});

describe("mergedUrls", () => {
	it("returns every merged PR URL", () => {
		expect(
			mergedUrls({
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
					{
						prUrl: "https://github.com/o/r/pull/43",
						detectedAt: "2026-08-30T00:00:00Z",
						reminderPending: true,
					},
				],
			}),
		).toEqual([
			"https://github.com/o/r/pull/42",
			"https://github.com/o/r/pull/43",
		]);
	});
});

describe("firstUnmergedGithubPrUrl", () => {
	it("selects next URL while excluding every merged URL", () => {
		expect(
			firstUnmergedGithubPrUrl(
				["https://github.com/o/r/pull/42 https://github.com/o/r/pull/43"],
				["https://github.com/o/r/pull/42"],
			),
		).toBe("https://github.com/o/r/pull/43");
	});

	it("returns null when all discovered URLs were already merged", () => {
		expect(
			firstUnmergedGithubPrUrl(
				["https://github.com/o/r/pull/42 https://github.com/o/r/pull/43"],
				["https://github.com/o/r/pull/42", "https://github.com/o/r/pull/43"],
			),
		).toBeNull();
	});
});
