/** Display grouping only; call with an outcome from validateTraceReport.
 * @param {{status: unknown, differing_fields: string[]}} row
 */
export function traceComparison(row) {
  const structuralFields = row.differing_fields.filter(
    (field) => field === "transactionIndex" || field === "cumulativeGasUsed",
  );
  const executionFields = row.differing_fields.filter(
    (field) => field !== "transactionIndex" && field !== "cumulativeGasUsed",
  );
  if (row.status !== "executed")
    return {
      kind: row.status === "skipped" ? "omitted" : "unavailable",
      label:
        row.status === "skipped"
          ? "Omitted · no receipt"
          : "No candidate receipt",
      structuralFields,
      executionFields,
    };
  return {
    kind: executionFields.length
      ? "execution"
      : structuralFields.length
        ? "structural"
        : "identical",
    label: executionFields.length
      ? "Execution receipt fields differ"
      : structuralFields.length
        ? "Position / cumulative gas only"
        : "Exact original receipt match",
    structuralFields,
    executionFields,
  };
}
