import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const moduleUrl=process.env.PLAYWRIGHT_MODULE||new URL('../../实验7_确定性层级体素/openplan/node_modules/playwright/index.mjs',import.meta.url).href;
const {chromium}=await import(moduleUrl);
const output=fileURLToPath(new URL('../../.private/office-2/qa/experiment9/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1536,height:1080},deviceScaleFactor:1});
const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
try{
 await page.goto(process.env.EXPERIMENT9_URL||'http://127.0.0.1:5189/实验9_先切分后分类体素/',{waitUntil:'networkidle',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#objects').children.length===5,{timeout:60000});
 assert.match(await page.locator('#status').innerText(),/分类守恒通过/);
 assert.equal(await page.locator('#grids tr').count(),5);
 assert.match(await page.locator('#clutter-state').innerText(),/跳过杂物计算/);
 const frame=page.frames().find(f=>f.url().includes('实验8_')||f.url().includes('%E5%AE%9E%E9%AA%8C8_'));
 assert.ok(frame,'embedded experiment8 viewer');
 await frame.waitForFunction(()=>window.__ANGRID_LAYERS__?.snapshot().layers.furnitureGrid.available,{timeout:60000});
 const loaded=await frame.evaluate(()=>window.__ANGRID_LAYERS__.snapshot());
 assert.equal(loaded.manifestLoaded,true); assert.equal(loaded.layers.structureGrid.available,true);
 await page.screenshot({path:output+'/qa-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:output+'/qa-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]); assert.deepEqual(failed,[]);
 const result={ok:true,browser:'Microsoft Edge headless',checks:['5 stable object mappings','face conservation table','four grid scales','skipClutter distinct from visibility','embedded real classified viewer','no mobile overflow'],pageErrors:errors,failedRequests:failed};
 await writeFile(output+'/smoke-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
