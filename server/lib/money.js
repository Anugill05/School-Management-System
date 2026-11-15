// Money helpers: all amounts are integer cents internally.

/** Convert a decimal amount (number|string, max 2 dp) to integer cents. Throws RangeError if invalid. */
export function toCents(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new RangeError('Amount must be a positive number with at most 2 decimals');
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RangeError('Amount must be greater than zero');
  return cents;
}

export const fromCents = (c) => Math.round(c) / 100;

/** Derive invoice status from its ledger sum. */
export function invoiceStatus({ amount_cents, outstanding_cents, voided }) {
  if (voided) return 'void';
  if (outstanding_cents <= 0) return 'paid';
  if (outstanding_cents < amount_cents) return 'partial';
  return 'issued';
}
