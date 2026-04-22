// Drives the prod app with a pre-seeded Azure ARM token to capture console output
// from the Metrics tab. Used to confirm whether get-history actually returns
// multi-point series or just one point per metric.
const { chromium } = require('playwright');

const TOKEN = process.env.AZ_TOKEN;
const SUB = process.env.AZ_SUB;
const TENANT = process.env.AZ_TENANT;
const RG = process.env.AZ_RG;
const WS = process.env.AZ_WS;
const LOC = process.env.AZ_LOC;
const RUN_ID = process.env.AZ_RUN;

if (!TOKEN || !SUB || !RUN_ID) {
  console.error('Missing env vars');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.addInitScript((data) => {
    const tokens = {
      accessToken: data.token,
      expiresAt: Date.now() + 3000 * 1000,
      clientId: 'cli-driver',
      tenantId: data.tenant,
      subscriptionId: data.sub,
    };
    const creds = { tenantId: data.tenant, clientId: 'cli-driver', clientSecret: '', subscriptionId: data.sub };
    const ws = {
      id: `/subscriptions/${data.sub}/resourceGroups/${data.rg}/providers/Microsoft.MachineLearningServices/workspaces/${data.ws}`,
      name: data.ws, resourceGroup: data.rg, location: data.loc, subscriptionId: data.sub,
    };
    localStorage.setItem('@aml_auth_tokens', JSON.stringify(tokens));
    localStorage.setItem('@aml_credentials', JSON.stringify(creds));
    localStorage.setItem('@aml_selected_workspace', JSON.stringify(ws));
  }, { token: TOKEN, sub: SUB, tenant: TENANT, rg: RG, ws: WS, loc: LOC });

  await page.goto('https://red-hill-00550a310.2.azurestaticapps.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'scripts/probe-1-loaded.png', fullPage: true });

  // Inspect what's visible
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  logs.push(`[driver] visible text after load:\n${bodyText}`);

  try {
    // Click first job card with a name we recognise
    const target = process.env.AZ_JOB_NAME || RUN_ID;
    await page.getByText(target, { exact: false }).first().click({ timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'scripts/probe-2-job.png', fullPage: true });
    await page.getByText(/Metrics/i).first().click({ timeout: 10000 });
    await page.waitForTimeout(30000);
    await page.screenshot({ path: 'scripts/probe-3-metrics.png', fullPage: true });
  } catch (e) {
    logs.push(`[driver] navigation error: ${e.message}`);
    await page.screenshot({ path: 'scripts/probe-error.png', fullPage: true });
  }

  console.log('===CONSOLE_DUMP_BEGIN===');
  for (const l of logs) console.log(l);
  console.log('===CONSOLE_DUMP_END===');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
