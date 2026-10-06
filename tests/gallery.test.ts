import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Browser checks run when the local app is available; unit checks run offline.
test('gallery browsing, image viewer, time-lapse, and mobile layout', { timeout: 240_000 }, async (context) => {
  const url = process.env.GALLERY_URL || process.env.npm_config_gallery_url;
  if (!url) { context.skip('Set GALLERY_URL to opt into browser checks against an archive.'); return; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !(await response.text()).includes('Procreator')) { context.skip('Start the gallery to run browser checks.'); return; }
  } catch { context.skip('Start the gallery to run browser checks.'); return; }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('.artwork').first().waitFor({ timeout: 120_000 });
    await page.locator('.poster img').evaluateAll(images => Promise.all(images.slice(0, 3).map(img => (img as HTMLImageElement).decode())));
    assert.equal(await page.locator('.artwork').count(), 100);
    await mkdir('.artifacts', { recursive: true });
    await page.screenshot({ path: '.artifacts/gallery-desktop.png' });
    const catalog = await (await page.request.get(`${url}/api/artworks`)).json();
    const tagged = catalog.items.find((item: { tags?: string[]; name: string; filename: string; folder: string }) => item.tags?.some(tag => !`${item.name} ${item.filename} ${item.folder}`.toLowerCase().includes(tag)));
    if (tagged) {
      const subject = tagged.tags.find((tag: string) => !`${tagged.name} ${tagged.filename} ${tagged.folder}`.toLowerCase().includes(tag));
      await page.getByLabel('Search', { exact: true }).fill(subject);
      assert.ok(await page.getByRole('button', { name: `View ${tagged.name}`, exact: true }).count() > 0);
      await page.getByLabel('Search', { exact: true }).fill('');
      await page.locator('.tag-browser summary').click();
      const tagButton = page.locator('.tag-words button').filter({ hasText: new RegExp(`^${subject} \\d+$`) });
      await tagButton.click();
      assert.equal(await tagButton.getAttribute('aria-pressed'), 'true');
      await page.locator('.artwork-open').first().click();
      await page.locator('.detail-tags').waitFor();
      await page.locator('.detail-tags button').filter({ hasText: new RegExp(`^${subject}$`) }).click();
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.screenshot({ path: '.artifacts/gallery-tags.png' });
      await page.getByRole('button', { name: 'Clear tag filter' }).click();
      await page.locator('.tag-browser summary').click();
    }
    const denied = await page.request.post(`${url}/api/tags`, { headers: { Origin: 'http://another-site.example' } });
    assert.equal(denied.status(), 403);
    await page.getByLabel('Search', { exact: true }).fill('no-such-artwork-xyz');
    await page.getByText('No works match this selection.').waitFor();
    await page.getByRole('button', { name: 'Show all works' }).click();
    assert.equal(await page.getByRole('button', { name: /Show more/ }).count(), 0);
    await page.locator('.gallery-progress').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.artwork').length === 200);
    assert.equal(await page.locator('.artwork').count(), 200);
    await page.locator('.gallery-progress').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.artwork').length === 300);
    await page.getByRole('button', { name: 'Newest', exact: true }).click();
    assert.equal(await page.locator('.artwork').count(), 100);
    const newest = [...catalog.items].sort((a, b) => b.date - a.date)[0];
    assert.equal(await page.locator('.artwork-open').first().getAttribute('aria-label'), `View ${newest.name}`);
    assert.equal(await page.locator('.item-line time').first().getAttribute('datetime'), new Date(newest.date).toISOString());
    await page.locator('.artwork-open').first().click();
    await page.locator('dialog[open]').waitFor();
    await page.locator('.stage img').evaluate((image: HTMLImageElement) => image.decode());
    await page.getByRole('button', { name: 'Fullscreen ↗', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('viewer-wrap'));
    assert.equal(await page.locator('.viewer-meta').isVisible(), false);
    await page.screenshot({ path: '.artifacts/gallery-fullscreen.png' });
    await page.getByRole('button', { name: 'Exit fullscreen ↙', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('.viewer-nav').innerText(), /2 \/ /);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.getByRole('button', { name: 'Name', exact: true }).click();
    await page.getByRole('button', { name: 'Time-lapses', exact: true }).click();
    await page.locator('.artwork-open').first().click();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator('.layer-stage img').waitFor({ timeout: 60_000 });
    await page.locator('.layer-stage img').evaluate((image: HTMLImageElement) => image.decode());
    await page.getByRole('button', { name: 'Fullscreen ↗', exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.screenshot({ path: '.artifacts/gallery-layers-fullscreen.png' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.ok(await page.locator('.layer-pick').count() >= 2);
    const firstLayer = await page.locator('.layer-stage img').getAttribute('src');
    await page.locator('.layer-pick').nth(1).click();
    await page.waitForFunction(old => {
      const image = document.querySelector<HTMLImageElement>('.layer-stage img');
      return image && image.src !== old && image.complete && image.naturalWidth > 0;
    }, firstLayer);
    assert.equal(await page.locator('.layer-pick').nth(1).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: '.artifacts/gallery-layers.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    // Some mobile browsers don't support element fullscreen; expanded view still works.
    await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
    await page.getByRole('button', { name: 'Fullscreen ↗', exact: true }).click();
    assert.equal(await page.locator('.viewer-wrap.is-fullscreen').count(), 1);
    await page.screenshot({ path: '.artifacts/gallery-fullscreen-mobile.png' });
    assert.ok(await page.locator('.viewer-wrap').evaluate(element => element.scrollWidth <= window.innerWidth));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.viewer-wrap.is-fullscreen').count(), 0);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.evaluate(() => { delete (document as any).fullscreenEnabled; });
    assert.ok(await page.locator('dialog').evaluate(element => element.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '.artifacts/gallery-layers-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Time-lapse ▷', exact: true }).click();
    const video = page.locator('video');
    await video.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0; }, { timeout: 60_000 });
    await video.evaluate(async (element: HTMLVideoElement) => { await element.play(); });
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime || 0) > 0.1);
    const info = await video.evaluate((v: HTMLVideoElement) => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }));
    console.log('Verified video:', info);
    await page.getByRole('button', { name: 'Fullscreen ↗', exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.ok((await video.boundingBox())!.height > 400);
    await page.getByRole('button', { name: 'Exit fullscreen ↙', exact: true }).click();
    await page.getByRole('button', { name: '2×', exact: true }).click();
    assert.equal(await video.evaluate((v: HTMLVideoElement) => v.playbackRate), 2);
    await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = v.duration * 0.8; });
    await page.screenshot({ path: '.artifacts/gallery-timelapse.png' });
    await page.getByRole('button', { name: 'Close ×' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '.artifacts/gallery-mobile.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
