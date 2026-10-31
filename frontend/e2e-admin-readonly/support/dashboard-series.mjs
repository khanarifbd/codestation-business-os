/** Read-only comparisons against the actual isolated PostgreSQL response; no fabricated history. */
export async function verifyDashboardSeries(page, expect, body, organizationId) {
  expect(body.organization_id).toBe(organizationId);
  expect(body.income_basis).toBe('received');
  expect(body.expense_basis).toBe('recorded');
  expect(body.counts.length).toBeGreaterThan(0);
  const explorer = page.getByRole('region', { name: 'Business trends', exact: true });
  await expect(explorer).toBeVisible();
  await verifyDashboardChartPriority(page, expect);
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
  const plot = countChart.locator('.dashboard-series-svg');
  const period = countChart.locator('.dashboard-series-current-period dd');
  const periodLabel = point => point.period_start === point.period_end ? point.period_start : `${point.period_start} – ${point.period_end}`;
  await expect(countChart.getByRole('combobox')).toHaveCount(0);
  await plot.focus();
  await plot.press('Home');
  await expect(period).toHaveText(periodLabel(body.counts[0]));
  await plot.press('End');
  await expect(period).toHaveText(periodLabel(body.counts.at(-1)));
  await expect(countChart.locator('.dashboard-series-values')).toContainText(String(body.counts[0].projects));
  await countChart.locator('summary').click();
  const bounds = await plot.boundingBox();
  expect(bounds).not.toBeNull();
  // Pointer interaction chooses the actual final bucket; it never synthesizes intermediate values.
  await plot.click({ position: { x: bounds.width * 0.98, y: bounds.height / 2 } });
  await expect(period).toHaveText(periodLabel(body.counts.at(-1)));
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
  const palette = { income: 'rgb(4, 120, 87)', expenses: 'rgb(185, 28, 28)', projects: 'rgb(29, 78, 216)', orders: 'rgb(126, 34, 206)', clients: 'rgb(146, 64, 14)' };
  for (const [key, color] of Object.entries(palette)) {
    const lines = explorer.locator(`.dashboard-series-line[data-series="${key}"]`);
    expect(await lines.count()).toBeGreaterThan(0);
    for (const line of await lines.all()) {
      await expect(line).toHaveCSS('stroke', color);
      const rgb = color.match(/\d+/g).map(Number).map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      expect(1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
  // Series identity cannot change when earlier selections disappear.
  await explorer.getByRole('checkbox', { name: 'Projects', exact: true }).uncheck();
  await expect(countChart.locator('.dashboard-series-line[data-series="orders"]')).toHaveCSS('stroke', palette.orders);
  await explorer.getByRole('checkbox', { name: 'Projects', exact: true }).check();
  await explorer.getByRole('checkbox', { name: 'Income', exact: true }).uncheck();
  for (const line of await explorer.locator('.dashboard-series-line[data-series="expenses"]').all()) await expect(line).toHaveCSS('stroke', palette.expenses);
  await explorer.getByRole('checkbox', { name: 'Income', exact: true }).check();
  expect(body.money.length).toBeGreaterThan(0);
  expect(body.counts.some(point => point.projects > 0 || point.orders > 0 || point.clients > 0)).toBe(true);
  expect(body.money.some(currency => currency.points.some(point => point.income !== '0.00' || point.expenses !== '0.00'))).toBe(true);
  return explorer;
}

/** Actual first-fold evidence, not a scrolled screenshot or DOM-order-only claim. */
export async function verifyDashboardChartPriority(page, expect) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const explorer = page.getByRole('region', { name: 'Business trends', exact: true });
  const charts = explorer.locator('.dashboard-series-charts');
  const options = explorer.locator('.dashboard-series-options');
  const filter = explorer.getByRole('button', { name: 'Choose dashboard date range', exact: true });
  const metrics = page.getByRole('region', { name: 'Key business metrics', exact: true });
  await expect(explorer.locator('.dashboard-series-svg').first()).toBeVisible();
  const dimensions = await explorer.evaluate(element => {
    const chartBoxes = [...element.querySelectorAll('.dashboard-series-charts')].map(chart => chart.getBoundingClientRect());
    const charts = { top: Math.min(...chartBoxes.map(box => box.top)), bottom: Math.max(...chartBoxes.map(box => box.bottom)) };
    const plot = element.querySelector('.dashboard-series-svg').getBoundingClientRect();
    const options = element.querySelector('.dashboard-series-options').getBoundingClientRect();
    const filter = element.querySelector('button[aria-label="Choose dashboard date range"]').getBoundingClientRect();
    const metrics = document.querySelector('.dashboard-operations-rail').getBoundingClientRect();
    return { charts: { top: charts.top, bottom: charts.bottom }, plot: { top: plot.top, bottom: plot.bottom, height: plot.height }, options: options.top, filter: filter.top, metrics: metrics.top, explorerBottom: element.getBoundingClientRect().bottom, viewport: innerHeight };
  });
  expect(dimensions.plot.top).toBeGreaterThanOrEqual(0);
  // A meaningful portion of the real plot must be in the opening viewport,
  // above the mobile bottom navigation; tiny clipped slivers do not qualify.
  expect(Math.min(dimensions.plot.bottom, dimensions.viewport - 80) - dimensions.plot.top).toBeGreaterThanOrEqual(Math.min(120, dimensions.plot.height));
  expect(dimensions.options).toBeGreaterThanOrEqual(dimensions.charts.bottom);
  expect(dimensions.filter).toBeGreaterThanOrEqual(dimensions.charts.bottom);
  expect(dimensions.metrics).toBeGreaterThanOrEqual(dimensions.explorerBottom);
  expect(await charts.count()).toBeGreaterThan(0);
  await expect(options).toHaveCount(1);
  await expect(filter).toHaveCount(1);
  await expect(metrics).toHaveCount(1);
}

/** Populated fixture evidence; caller retains its standard privacy masks/manifest. */
export async function captureDashboardPopupEvidence(page, expect, capture) {
  const trigger = page.getByRole('button', { name: 'Choose dashboard date range', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Dashboard date range', exact: true });
  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(dialog).not.toBeVisible();
    await verifyDashboardChartPriority(page, expect);
    await capture(`chart-first-closed-${size}`);
    await trigger.click();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel('From', { exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Apply range', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await capture(`date-popup-open-${size}`);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
}
