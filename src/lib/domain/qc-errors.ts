/** Translate known database business rules; never expose arbitrary SQL errors. */
export function qcMutationError(code: string, message = ""): string {
  if (code === "P0001") {
    const businessRules: Record<string, string> = {
      "COA dates must match the manufacturing and expiry dates of the stocked lot.":
        "COA dates do not match the stocked lot. Use the MFG date recorded in production and its matching expiry date. The release date can be different.",
      "Use the current inspection after the approved retest.":
        "This inspection was superseded by a retest. Select the current passed inspection and preview the COA again.",
      "Withdrawn certificate history cannot be edited.":
        "This COA was withdrawn and cannot be edited. Its history is retained.",
    };
    if (Object.hasOwn(businessRules, message)) return businessRules[message];
  }
  const messages: Record<string, string> = {
    "23505": "This number or code is already used.",
    "23503": "This record is referenced elsewhere or its reference is invalid.",
    P0002: "Record not found or already deleted.",
    "42501": "Session expired or access denied.",
    "23514": "Check the specifications and dates.",
    "55000":
      "Results are certified or specifications changed. Reload the data.",
  };
  return messages[code] ?? "Could not save changes. Retry.";
}
