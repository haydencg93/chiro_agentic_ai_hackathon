const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function formatCurrency(value = 0) {
  return currencyFormatter.format(toNumber(value));
}

export function formatPercent(value = 0) {
  return percentFormatter.format(toNumber(value));
}
