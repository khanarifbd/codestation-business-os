/** Read-only comparisons against the actual isolated PostgreSQL response; no fabricated history. */
export async function verifyDashboardSeries(page, expect, body, organizationId) {
  expect(body.organization_id).toBe(organizationId);
  expect(body.income_basis).toBe('received');
  expect(body.expense_basis).toBe('recorded');
  expect(body.counts.length).toBeGreaterThan(0);
  const explorer = page.getByRole('region', { name: 'Business trends', exact: true });
  await expect(explorer).toBeVisible();
  for (const label of ['Income', 'Expenses', 'Projects', 'Orders', 'Clients']) {
    const toggle = explorer.getByRole('checkbox', { name: label, exact: true });
    await expect(toggle).toHaveCount(1);
    await toggle.check();
  }
  const countChart = explorer.getByRole('region', { name: 'Records created over time', exact: true });
  await expect(countChart).toBeVisible();
  await expect(countChart.locator('polyline')).toHaveCount(body.counts.length > 1 ? 3 : 0);
  await expect(countChart.locator('.dashboard-series-unit')).toHaveText('Records created');
  const normalize = values => values.map(value => value.replaceAll(',', '').trim());
  await countChart.locator('summary').click();
  expect(normalize(await countChart.locator('tbody td').allTextContents())).toEqual(body.counts.flatMap(point => ['projects', 'orders', 'clients'].map(key => String(point[key]))));
  const period = countChart.getByRole('combobox', { name: 'Explore period for Records created over time', exact: true });
  await period.focus();
  await period.press('Home');
  await period.press('Enter');
  await expect(period).toHaveValue(body.counts[0].period_start);
  await expect(countChart.locator('.dashboard-series-values')).toContainText(String(body.counts[0].projects));
  await countChart.locator('summary').click();
  const plot = countChart.locator('.dashboard-series-svg');
  const bounds = await plot.boundingBox();
  expect(bounds).not.toBeNull();
  // Pointer interaction chooses the actual final bucket; it never synthesizes intermediate values.
  await plot.click({ position: { x: bounds.width * 0.98, y: bounds.height / 2 } });
  await expect(period).toHaveValue(body.counts.at(-1).period_start);
  for (const currency of body.money) {
    const chart = explorer.getByRole('region', { name: `Income and expenses · ${currency.currency}`, exact: true });
    await expect(chart).toBeVisible();
    await expect(chart.locator('polyline')).toHaveCount(body.counts.length > 1 ? 2 : 0);
    await expect(chart.locator('.dashboard-series-unit')).toHaveText(currency.currency);
    await chart.locator('summary').click();
    const actual = normalize(await chart.locator('tbody td').allTextContents());
    const expected = currency.points.flatMap(point => ['income', 'expenses'].map(key => `${currency.currency} ${point[key]}`));
    expect(actual).toEqual(expected);
    await chart.locator('summary').click();
  }
  expect(body.money.length).toBeGreaterThan(0);
  expect(body.counts.some(point => point.projects > 0 || point.orders > 0 || point.clients > 0)).toBe(true);
  expect(body.money.some(currency => currency.points.some(point => point.income !== '0.00' || point.expenses !== '0.00'))).toBe(true);
  return explorer;
}
