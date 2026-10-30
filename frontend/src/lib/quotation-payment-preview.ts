/** Mirrors quotation_v2._payment_amounts; percentage remainder applies only to all-100% schedules. */
export type PaymentPreviewInput = { payment_type: string; percentage: string | number; amount: string | number };
const ZERO = BigInt(0), HUNDRED = BigInt(100), SCALE = BigInt(10000), MAX = BigInt('9999999999999999');
function scaled(value: string | number, places: number, maximum: bigint): bigint | null {
  const text = String(value).trim();
  if (text.length > 100) return null;
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) return null;
  const fraction = m[3] ?? m[4] ?? '';
  const exponent = Number(m[5] || 0) - fraction.length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  const coefficient = BigInt((m[2] || '0') + fraction);
  if (m[1] === '-' && coefficient !== ZERO) return null;
  const shift = exponent + places, factor = BigInt('1' + '0'.repeat(Math.abs(shift)));
  if (shift < 0 && coefficient % factor !== ZERO) return null;
  const result = shift >= 0 ? coefficient * factor : coefficient / factor;
  return result <= maximum ? result : null;
}
function text(value: bigint) {
  const magnitude = value < ZERO ? -value : value;
  return `${value < ZERO ? '-' : ''}${magnitude / HUNDRED}.${String(magnitude % HUNDRED).padStart(2, '0')}`;
}
export function quotationPaymentPreview(total: string | number, payments: PaymentPreviewInput[]) {
  const cents = scaled(total, 2, MAX);
  if (cents === null) return null;
  const amounts: bigint[] = [];
  let percentages = ZERO;
  for (const payment of payments) {
    if (payment.payment_type === 'percentage') {
      const percentage = scaled(payment.percentage, 4, HUNDRED * SCALE);
      if (percentage === null || percentage === ZERO) return null;
      percentages += percentage;
      const denominator = HUNDRED * SCALE;
      amounts.push((cents * percentage + denominator / BigInt(2)) / denominator);
    } else if (payment.payment_type === 'fixed') {
      const amount = scaled(payment.amount, 2, MAX);
      if (amount === null) return null;
      amounts.push(amount);
    } else return null;
  }
  let sum = amounts.reduce((a, b) => a + b, ZERO);
  if (payments.length && payments.every(p => p.payment_type === 'percentage') && percentages === HUNDRED * SCALE) {
    amounts[amounts.length - 1] += cents - sum;
    sum = cents;
  }
  return { amounts: amounts.map(text), total: text(sum), difference: text(cents - sum), reconciled: payments.length === 0 || sum === cents };
}
