// Subscription price. The database function price_for_units is the source of truth; this mirrors it for display
// and a test keeps the two in step.
export const BASE_PRICE = 1000;
export const INCLUDED_UNITS = 20;
export const EXTRA_UNIT_PRICE = 15;

export const priceForUnits = (units: number) => BASE_PRICE + Math.max(0, units - INCLUDED_UNITS) * EXTRA_UNIT_PRICE;

/** "25 houses: 1,000 + 5 × 15 = 1,075" */
export function priceFormula(units: number): string {
  const extra = Math.max(0, units - INCLUDED_UNITS);
  const n = (v: number) => v.toLocaleString("en-KE");
  const noun = units === 1 ? "house" : "houses";
  return extra > 0
    ? `${units} ${noun}: ${n(BASE_PRICE)} + ${extra} × ${EXTRA_UNIT_PRICE} = ${n(priceForUnits(units))}`
    : `${units} ${noun} (${INCLUDED_UNITS} included): ${n(BASE_PRICE)}`;
}
