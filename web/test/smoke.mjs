// Smoke test: boot the player headlessly and evaluate EVERY track.
// A track fails if the #error panel shows after eval. Run against a live dev
// server:  node test/smoke.mjs   (PLAYER_URL overrides http://localhost:5273)
//
// Uses `puppeteer` if installed (CI), else `puppeteer-core` against the
// system Chrome (local).

const BASE = process.env.PLAYER_URL || 'http://localhost:5273';

async function launch() {
  const args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'];
  try {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch({ headless: 'new', args });
  } catch {
    const { default: puppeteer } = await import('puppeteer-core');
    return puppeteer.launch({ headless: 'new', channel: 'chrome', args });
  }
}

const browser = await launch();
const page = await browser.newPage();
page.setDefaultTimeout(240_000);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // engine boot + sample-pack prebake can take a while on a cold cache
  await page.waitForFunction(() => window.__player?.state?.ready && window.__player?.state?.track);

  const results = await page.evaluate(async () => {
    const p = window.__player;
    const out = {};
    for (const t of p.state.tracks) {
      await p.selectTrack(t);
      await p.evalCode(p.state.code);
      await new Promise((r) => setTimeout(r, 500));
      const err = document.getElementById('error');
      out[t] = err.hidden ? 'ok' : err.textContent.trim();
    }
    document.getElementById('stop').click();
    return out;
  });

  let failed = 0;
  for (const [track, result] of Object.entries(results)) {
    const ok = result === 'ok';
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${track}${ok ? '' : `\n    ${result}`}`);
  }
  console.log(`\n${Object.keys(results).length - failed}/${Object.keys(results).length} tracks eval clean`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
