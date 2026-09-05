import { z } from "zod";

const OPEN_STATE = "OPEN";
const CLOSED_STATE = "CLOSED";
const MERGED_STATE = "MERGED";

const prStateSchema = z.enum([OPEN_STATE, CLOSED_STATE, MERGED_STATE]);

export const openPrRowSchema = z
	.object({
		url: z.string().optional(),
		state: prStateSchema.optional(),
	})
	.loose();

export const openPrRowsSchema = z.array(openPrRowSchema);

export const mergedPrDataSchema = z
	.object({
		state: prStateSchema.optional(),
		mergedAt: z.string().optional(),
	})
	.loose();

export const headRefSchema = z.object({ headRefName: z.string() }).loose();

export const currentPrSchema = z
	.object({
		url: z.string(),
		headRefName: z.string(),
	})
	.loose();

const mergedPrSchema = z.object({
	prUrl: z.string(),
	detectedAt: z.string(),
	reminderPending: z.boolean(),
});

export const prStateDataSchema = z
	.object({
		prUrl: z.string().optional(),
		mergedPrs: z.array(mergedPrSchema).optional(),
		discoveryDisabled: z.boolean().optional(),
	})
	.loose();
