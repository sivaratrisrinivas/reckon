import {test, expect, type APIRequestContext} from '@playwright/test';

// Local sandbox with scripted external providers. The exhausted key is produced by re-adding the publication key with a
// tiny remainder; the network then rejects publication exactly as it does for a key that spent its whole allowance
// (tests/rehearsal-permissions.ts drains a key through real publications).
const FIVE_NEAR = 5n * 10n ** 24n;

type Operational = {
  label: string;
  dead: boolean;
  publication_available: boolean;
  operational_unavailability: string | null;
  reason: string | null;
  publication_key: {allowance_yocto: string; required_allowance_yocto: string; publications_remaining: number};
  reserve: {free_reserve_yocto: string; adequate: boolean};
};
const operational = async (request: APIRequestContext) => await (await request.get('/api/operational')).json() as Operational;
const life = async (request: APIRequestContext) => await (await request.get('/api/life')).json() as {dead: boolean; spendable_bankroll: string; remaining_life_ns: string};

test('an exhausted publication key is operational unavailability rather than death, and other callers still settle', async ({page, request}) => {
  await request.post('/test/forecast-scenario', {data: {scenario: 'publish'}});
  await request.post('/test/reset-forecast-limits');
  const baseline = await operational(request);
  expect(baseline.label).toContain('local sandbox');
  expect(baseline.dead).toBe(false);
  expect(baseline.publication_available).toBe(true);
  expect(baseline.operational_unavailability).toBeNull();
  expect(BigInt(baseline.publication_key.allowance_yocto)).toBeGreaterThan(FIVE_NEAR - 10n ** 23n);
  expect(BigInt(baseline.publication_key.allowance_yocto)).toBeLessThanOrEqual(FIVE_NEAR);
  expect(baseline.publication_key.publications_remaining).toBeGreaterThan(10);
  expect(baseline.reserve.adequate).toBe(true);

  // An outstanding challenged round exists when the allowance runs out.
  await request.post('/api/wallet/fund');
  await page.goto('/');
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator('#forecast-status')).toContainText(/Prediction #\d+ is published/);
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  await approval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});

  try {
    expect((await request.post('/test/publication-key', {data: {scenario: 'exhaust'}})).status()).toBe(204);
    const exhausted = await operational(request);
    expect(exhausted.publication_available).toBe(false);
    expect(exhausted.operational_unavailability).toBe('publication_key_allowance_exhausted');
    expect(exhausted.dead).toBe(false);
    expect(exhausted.reason).toMatch(/allowance/i);
    expect(BigInt(exhausted.publication_key.allowance_yocto)).toBeLessThan(BigInt(exhausted.publication_key.required_allowance_yocto));
    expect(exhausted.publication_key.publications_remaining).toBe(0);
    const lifeExhausted = await life(request);
    expect(lifeExhausted.dead, 'operational unavailability is not death').toBe(false);
    expect(BigInt(lifeExhausted.remaining_life_ns)).toBeGreaterThan(0n);

    // Adding funds neither revives usable bankroll nor resets the allowance.
    expect((await request.post('/test/fund-contract')).status()).toBe(204);
    const funded = await operational(request);
    expect(funded.publication_key.allowance_yocto).toBe(exhausted.publication_key.allowance_yocto);
    expect(funded.publication_available).toBe(false);
    expect(BigInt(funded.reserve.free_reserve_yocto)).toBeGreaterThan(BigInt(exhausted.reserve.free_reserve_yocto));
    expect(BigInt((await life(request)).spendable_bankroll)).toBeLessThanOrEqual(BigInt(lifeExhausted.spendable_bankroll));

    // Other callers still settle and pay the outstanding challenged round without the publication key.
    expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
    expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
    await expect(page.locator('#settlement-state')).toContainText('Resolved YES', {timeout: 20_000});
    await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain');
    expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
    expect((await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0].outcome).toBe('yes');

    // The idle, exhausted agent declines a request before any inference and says why, without claiming death.
    const modelCallsBefore = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
    await page.reload();
    await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
    await expect(page.locator('#life-state')).not.toHaveText('Depleted · permanently dead');
    await page.getByRole('button', {name: 'Ask Reckon'}).click();
    await expect(page.locator('#forecast-status')).toContainText('No prediction was published');
    await expect(page.locator('#forecast-status')).toContainText(/allowance is exhausted/i);
    await expect(page.locator('#forecast-status')).not.toContainText(/permanently dead/i);
    await expect(page.locator('#life-state')).not.toHaveText('Depleted · permanently dead');
    const refusal = await request.post('/api/forecast', {data: {}});
    expect(refusal.status()).toBe(503);
    const body = await refusal.json() as {status: string; cause: string; reason: string};
    expect(body.status).toBe('unavailable');
    expect(body.cause).toBe('publication_key_allowance_exhausted');
    expect(body.reason).toMatch(/not dead/i);
    expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls, 'no inference is spent while publication is unavailable').toBe(modelCallsBefore);
    expect((await life(request)).dead).toBe(false);
  } finally {
    expect((await request.post('/test/publication-key', {data: {scenario: 'restore'}})).status()).toBe(204);
  }
  const restored = await operational(request);
  expect(restored.publication_available).toBe(true);
  expect(restored.operational_unavailability).toBeNull();
});
