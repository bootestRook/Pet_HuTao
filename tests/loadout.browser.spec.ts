import { test, expect } from '@playwright/test';
import { ITEMS, PETS } from '../shared/catalog.js';

for (const width of [1440, 390]) test(`compact rich descriptions and a strict three-item loadout at ${width}px`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'no-preference' });
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL!); await page.getByLabel('你的昵称').fill('说明与槽位检查');
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page.locator('#room')).toBeVisible();
    await expect(page.locator('#selected-pet-name')).toHaveText('胡涛');
    await expect(page.locator('#catalog-grid [data-candidate]')).toHaveCount(3);
    await expect(page.locator('[data-candidate="charge"], [data-candidate="renew"]')).toHaveCount(0);
    for (const pet of PETS) {
      await page.locator(`[data-candidate="${pet.id}"]`).click();
      await expect(page.locator('#detail-name')).toHaveText(pet.name);
      await expect(page.locator('#detail-description .effect-name')).toHaveText(pet.effects.map(e => e.name));
      await expect(page.locator('#detail-description .effect-value').first()).toBeVisible();
      expect(await page.locator('#detail-description').textContent()).not.toMatch(/【|】|同步|插值|特效|身高|Steam/);
      const statistics = await page.locator('#detail-stats dd').evaluateAll(nodes => nodes.map(node => {
        const element = node as HTMLElement; return { nowrap: getComputedStyle(element).whiteSpace, fits: element.scrollWidth <= element.clientWidth };
      }));
      expect(statistics.every(stat => stat.nowrap === 'nowrap' && stat.fits)).toBe(true);
      const title = page.locator('.effect-name').first();
      expect(await title.evaluate(el => getComputedStyle(el).animationName)).toBe('skill-gilding');
      await page.locator('#candidate-detail').screenshot({ path: testInfo.outputPath(`${pet.id}-${width}.png`) });
    }
    const firstTitle = page.locator('.effect-name').first();
    const initialPosition = await firstTitle.evaluate(el => getComputedStyle(el).backgroundPosition);
    await expect.poll(() => firstTitle.evaluate(el => getComputedStyle(el).backgroundPosition)).not.toBe(initialPosition);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await firstTitle.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.locator('#detail-note, #detail-category')).toHaveCount(0);
    await page.locator('#catalog-tabs [data-category="items"]').click();
    for (const item of ITEMS) {
      await page.locator(`[data-candidate="${item.id}"]`).click();
      await expect(page.locator('#detail-description .effect-value').first()).toBeVisible();
      expect((await page.locator('#detail-description').textContent())!.length).toBeLessThan(100);
      await expect(page.locator('#detail-stats')).toBeHidden();
      if (item.id === 'plain-club' || item.id === 'rewind-tape') await page.locator('#candidate-detail').screenshot({ path: testInfo.outputPath(`${item.id}-${width}.png`) });
    }
    for (const item of ITEMS.slice(0, 3)) {
      await page.locator(`[data-candidate="${item.id}"]`).click(); await page.locator('#equip-candidate').click();
    }
    await expect(page.locator('#equipped-count')).toHaveText('3 / 3');
    await expect(page.locator('#equipped-slots .equipped-slot')).toHaveCount(3);
    await page.locator(`[data-candidate="${ITEMS[3].id}"]`).click();
    await expect(page.locator('#equip-candidate')).toBeDisabled();
    await expect(page.locator('#detail-hint')).toContainText('最多携带 3 件');
    await page.locator(`[data-equipped-id="${ITEMS[0].id}"]`).click();
    await page.locator(`[data-candidate="${ITEMS[3].id}"]`).click(); await page.locator('#equip-candidate').click();
    await expect(page.locator(`[data-equipped-id="${ITEMS[3].id}"]`)).toHaveCount(1);
    await page.locator(`[data-equipped-id="${ITEMS[3].id}"]`).click(); await page.locator('#unequip-candidate').click();
    await expect(page.locator('#equipped-count')).toHaveText('2 / 3');
    await page.locator('#equipped-slots').screenshot({ path: testInfo.outputPath(`three-slots-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
