import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleClaimError } from "../shared/claim-error.ts";
import { HERDR } from "./constants.ts";

export function notifyHerdrFailure(
	context: ExtensionContext,
	error: string,
): void {
	handleClaimError(context, { jobType: HERDR, error });
}
