/** Apply tenant markup: base + fixed cents + percent of base. */
export function applyShippingMarkup(
  baseDollars: number,
  markupFixedCents: number,
  markupPercent: number
): number {
  const fixed = markupFixedCents / 100;
  const percent = (baseDollars * markupPercent) / 100;
  return Math.round((baseDollars + fixed + percent) * 100) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}
