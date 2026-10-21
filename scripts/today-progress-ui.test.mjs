import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../app/today-progress.js',import.meta.url),'utf8');
function context(data={}){class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-21T04:00:00Z']));}static now(){return Date.parse('2026-10-21T04:00:00Z');}}const ctx=vm.createContext({D:{platforms:[],todayProgress:[],...data},Date:Clock,Intl});vm.runInContext(source,ctx);return ctx;}
const render=ctx=>vm.runInContext("todayProgressPanel('all','2026-10')",ctx);
test('six unknown cash values render a closed compact information bar with full optional details',()=>{
 const ctx=context(),html=render(ctx);assert.ok(html.startsWith('<details class="today-progress today-progress--all today-progress--empty"'));assert.ok(html.includes('今日進度尚未取得；下方採截至昨日完整日'));assert.ok(html.includes('0／6 站'));assert.ok(html.includes('查看詳情'));assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(html));assert.equal((html.match(/<article class="tp-chip/g)||[]).length,6);assert.ok(html.includes('各站實際完整日截止日'));assert.ok(!html.includes('tp-heading'));
});
test('one verified cash value, including true zero, keeps the existing full card',()=>{
 for(const cash of [0,123]){const ctx=context({todayProgress:[{platform:'win',date:'2026-10-21',todayCash:cash,dau:0,dpu:0,capturedAt:'2026-10-21T04:00:00Z'}]}),html=render(ctx);assert.ok(html.startsWith('<section'));assert.ok(!html.includes('today-progress--empty'));assert.ok(html.includes('已知 1／6 站'));assert.ok(html.includes('<strong>'+cash+'</strong>'));}
 const ctx=context({todayProgress:['win','qz','song','rd','lucky','bo'].map(platform=>({platform,date:'2026-10-21',todayCash:0,dau:0,dpu:0}))}),html=render(ctx);assert.ok(html.includes('六站均有今日數據'));assert.ok(html.includes('六站今日官儲</span><strong>0</strong>'));
});
test('old snapshots, complete-day cash and other-month data never become today; source remains unchanged',()=>{
 const data={todayProgress:[{platform:'win',date:'2026-10-20',todayCash:99999,dau:20}],daily:{win:[['2026-10-20',20,1,1,99999]]},monthSnapshots:[{platform:'win',month:'2026-10',through:'2026-10-21',deposit:99999}]},before=JSON.stringify(data),ctx=context(data),html=render(ctx);assert.ok(html.includes('today-progress--empty'));assert.ok(!html.includes('99999'));assert.equal(vm.runInContext("todayProgressPanel('all','2026-09')",ctx),'');assert.equal(JSON.stringify(data),before);
});
test('known activity without cash is expandable rather than treated as verified zero, with escaped names',()=>{
 const ctx=context({platforms:[{key:'win',name:'<img src=x onerror=bad>'}],todayProgress:[{platform:'win',date:'2026-10-21',todayCash:null,dau:42,dpu:7,capturedAt:'2026-10-21T04:00:00Z'}]}),html=render(ctx);assert.ok(html.includes('today-progress--empty'));assert.ok(html.includes('DAU <b>42</b>'));assert.ok(html.includes('DPU <b>7</b>'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('undefined'));
});
