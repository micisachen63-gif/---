import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {buildBackendMetrics} from './backend-metrics.mjs';

const live='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
async function context(){
 const app=await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8');
 const ui=await fs.readFile(new URL('../app/competitor-v2.js',import.meta.url),'utf8');
 const normalized=await buildBackendMetrics(live);
 const dashboard=JSON.parse(await fs.readFile(new URL('../data/dashboard.json',import.meta.url),'utf8'));
 dashboard.competitors=normalized.competitors;
 const ctx=vm.createContext({URL,console});
 vm.runInContext(app.slice(0,app.indexOf('function selectProduct'))+'\n'+ui,ctx);
 ctx.input=dashboard;vm.runInContext('D=input',ctx);return ctx;
}
test('four aggregate competitor overviews render actual KPIs and correct RTP units',async()=>{
 const ctx=await context();
 for(const name of ['發又發','黑桃A','財哥','超吉爆']){
  ctx.siteName=name;
  const html=vm.runInContext("state.section='overview'; competitorViewV2(D.competitors.find(c=>c.name===siteName))",ctx);
  const expectedRange=vm.runInContext("(()=>{const p=cv2Comparison(D.competitors.find(c=>c.name===siteName));return cv2Range(p.currentFrom,p.currentThrough)})()",ctx);
  assert.ok(html.includes(expectedRange));assert.ok(html.includes('RTP'));assert.ok(html.includes('派彩 / 投注'));assert.ok(html.includes('data-month-index="9"'));assert.ok(!html.includes('undefined'));assert.ok(!html.includes('NaN'));
 }
 const html=vm.runInContext("competitorViewV2(D.competitors.find(c=>c.key==='o8'))",ctx);
 const cash=vm.runInContext("num(D.competitors.find(c=>c.key==='o8').normalizedMetrics.current.cash)",ctx);
 const rtp=vm.runInContext("num(D.competitors.find(c=>c.key==='o8').normalizedMetrics.current.gameRTPPercent,2)+'%'",ctx);
 assert.ok(html.includes(cash));assert.ok(html.includes(rtp));assert.ok(!html.includes('<td>fixture-login-account</td>'));
});
test('selected monthly details keep current partial-day snapshot separate and parse daily percent points once',async()=>{
 const ctx=await context();
 const html=vm.runInContext("state.section='monthly';state.month='2026-10';competitorViewV2(D.competitors.find(c=>c.key==='o8'))",ctx);
 const through=vm.runInContext("D.competitors.find(c=>c.key==='o8').normalizedMonthly.find(m=>m.month==='2026-10').through",ctx);
 assert.ok(html.includes(through));assert.ok(html.includes('MAU'));assert.ok(html.includes('MPU'));assert.ok(html.includes('data-select-month="2026-09"'));assert.ok(html.includes('<details'));assert.ok(!html.includes('NaN'));
 const future=vm.runInContext("state.month='2026-12';competitorViewV2(D.competitors[0])",ctx);
 assert.ok(future.includes('此月尚無後台月報快照'));assert.ok(!future.includes('undefined'));
});
test('benchmark uses complete same-day source data and labels missing acquisition as unknown',async()=>{
 const ctx=await context();
 const html=vm.runInContext('competitorBenchmarkPanel()',ctx);
 const scope=vm.runInContext('cv2MarketPeriod()',ctx),win=vm.runInContext("cv2BenchmarkItems().find(i=>i.key==='win')",ctx);
 assert.ok(html.includes('六個自有站點'));assert.ok(html.includes(scope.currentThrough));assert.ok(html.includes('註冊數依後台註冊／留存來源'));
 if(win.cash!==null){ctx.expectedRate=win.cash;assert.ok(html.includes(vm.runInContext('percent(expectedRate)',ctx)));}
 assert.ok(html.includes('買幣變化'));assert.ok(html.includes('賣幣變化'));
 const absent=vm.runInContext("(()=>{const c=D.competitors[0];c.normalizedDaily=[];D.competitorArchives.platforms=D.competitorArchives.platforms.filter(a=>a.platform!==c.key);if(D.competitorArchive?.platform===c.key)D.competitorArchive=null;const market=D.marketFundingComparisons.rows.find(r=>r.platform===c.key);if(market)market.dailyMetrics=null;return cv2Compared(c)})()",ctx);assert.equal(absent.valid,false);assert.equal(absent.current.cash,null);assert.equal(absent.current.dau,null);
});
