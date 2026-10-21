import { coaExpiryDate } from "./coa-dates";
export type CoaLotDates = {
  mfg_date: string | null;
  expiry_date: string | null;
  locked: boolean;
  source: "production" | "stock";
};
/** Once posted, production/stock dates are authoritative, not editable COA data. */
export function coaProductionDates(lot: CoaLotDates | null | undefined) {
  if (!lot?.locked || !lot.mfg_date) return null;
  const expiry = coaExpiryDate(lot.mfg_date);
  if (lot.expiry_date && lot.expiry_date !== expiry)
    throw Error(
      "The stocked lot's expiry does not match the one-year COA policy. Review the production/stock dates before issuing a COA.",
    );
  return { mfg_date: lot.mfg_date, tanggal_expired: expiry };
}
