import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {analyzeGiftReports,buildMerchantCandidates} from './merchant-candidates.mjs';

const header=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
const report=(rows,extra={})=>({platform:'demo',from:'2000-10-14',through:'2000-10-20',capturedAt:'2000-10-20T01:00:00Z',sourceUrl:'https://example.invalid/statements/giving',header,rows,totalRows:rows.length,complete:true,...extra});
const parse=(data,file='gift-rank-demo.json')=>analyzeGiftReports([{file,data}]);
test('directed give is counted once per edge and a reverse row is not a second copy of net',()=>{
 const d=parse(report([['1','00001','A','90071992547409931','B','20.5','-30'],['2','90071992547409931','B','00001','A','50.5','30']])),g=d.groups[0],a=g.accounts.find(a=>a.aid==='00001');
 assert.equal(g.directedEdges,2);assert.equal(g.observedDirectedGive,71);assert.equal(a.out,20.5);assert.equal(a.in,50.5);assert.equal(a.netIn,30);assert.equal(a.uniqueCounterparties,1);assert.equal(a.bidirectionalCounterparties,1);assert.equal(a.concentration.largestCounterpartyShare,1);assert.equal(a.concentration.hhi,1);assert.equal(g.validation.netChecks.matched,2);assert.equal(g.accounts[1].aid==='90071992547409931'||g.accounts[0].aid==='90071992547409931',true);
});
test('duplicate edges do not inflate amounts; a conflicting later snapshot is preserved but unverified',()=>{
 const row=['1','A','金庫 A','B','B','100','100'],r=report([row,row]);let g=parse(r).groups[0];assert.equal(g.observedDirectedGive,100);assert.equal(g.validation.duplicateRows,1);
 g=analyzeGiftReports([{file:'a.json',data:report([row])},{file:'b.json',data:report([[...row.slice(0,5),'120','120']],{capturedAt:'2000-10-20T02:00:00Z'})}]).groups[0];assert.equal(g.observedDirectedGive,120);assert.equal(g.complete,false);assert.equal(g.validation.conflicts.length,1);assert.equal(g.sources.length,2);
});
test('partial source does not invent an absent reverse edge or infer zero net',()=>{
 const g=parse(report([['1','A','A','B','B','10','5']],{complete:false})).groups[0];assert.equal(g.complete,false);assert.equal(g.validation.netChecks.notCheckable,1);assert.equal(g.validation.netChecks.checked,0);assert.equal(g.accounts.find(a=>a.aid==='A').out,10);assert.equal(g.accounts.find(a=>a.aid==='A').bidirectionalCounterparties,0);
});
test('missing amount is invalid rather than zero; missing header and bad dates keep provenance',()=>{
 let g=parse(report([['1','A','A','B','B','','0']])).groups[0];assert.equal(g.validation.invalidRows.length,1);assert.equal(g.complete,false);assert.equal(g.accounts.length,0);
 g=parse(report([],{header:['unknown']})).groups[0];assert.equal(g.validation.headerErrors.length,1);assert.equal(g.complete,false);assert.equal(g.sources[0].sourceUrl,'https://example.invalid/statements/giving');
 assert.equal(parse(report([],{through:'2000-02-31'})).unusableSources.length,1);
});
test('name-only clue cannot become confirmed merchant; broad bidirectional hub gains priority',()=>{
 const rows=[];for(let i=0;i<10;i++){rows.push([String(i*2),'hub','示例金庫','p'+i,'peer '+i,'100','50']);rows.push([String(i*2+1),'p'+i,'peer '+i,'hub','示例金庫','50','-50']);}
 const g=parse(report(rows)).groups[0],hub=g.candidates.find(c=>c.aid==='hub');assert.equal(hub.level,'high');assert.equal(hub.uniqueCounterparties,10);assert.equal(hub.bidirectionalCounterparties,10);assert.ok(Math.abs(hub.concentration.largestCounterpartyShare-.1)<1e-9);
 for(const c of g.accounts){assert.equal(c.verifiedMerchant,false);assert.equal(c.includeInRevenue,false);}
 const nameOnly=parse(report([['1','named','示例金控','other','Other','100','100']])).groups[0].candidates.find(c=>c.aid==='named');assert.equal(nameOnly.level,'low');
});
test('different windows stay separate and filesystem discovery uses only gift-rank JSON',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'merchant-candidates-'));try{
  await fs.writeFile(path.join(dir,'gift-rank-one.json'),JSON.stringify(report([['1','A','金庫 A','B','B','1','1']])));await fs.writeFile(path.join(dir,'gift-rank-two.json'),JSON.stringify(report([['1','A','金庫 A','B','B','2','2']],{from:'2000-09-24',through:'2000-09-30'})));await fs.writeFile(path.join(dir,'unrelated.json'),'broken json');
  const d=await buildMerchantCandidates(dir);assert.equal(d.groups.length,2);assert.deepEqual(d.groups.map(g=>g.observedDirectedGive),[2,1]);assert.equal(d.groups[1].days,7);
 }finally{for(const file of ['gift-rank-one.json','gift-rank-two.json','unrelated.json'])await fs.unlink(path.join(dir,file)).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(dir);}
});
test('panel shows source period, candidate AID, observed directions and evidence while escaping names',async()=>{
 const data=parse(report([['1','A','<img>金庫','B','Other','100','100']])),source=await fs.readFile(new URL('../app/merchant-candidates.js',import.meta.url),'utf8');const c=vm.createContext({D:{merchantCandidates:data},state:{product:'demo',month:'2000-10'}});
 vm.runInContext(`const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const num=(v,d=0)=>v==null?'—':Number(v).toFixed(d);const percent=v=>(v*100).toFixed(1)+'%';const row=c=>'<tr>'+c.map(x=>'<td>'+x+'</td>').join('')+'</tr>';const table=(h,r)=>h.join(' ')+'<table>'+r.join('')+'</table>';const panel=(t,s,b)=>t+s+b;const empty=(a,b)=>a+b;const sourceNote=x=>x;`,c);vm.runInContext(source,c);
 const html=vm.runInContext('merchantCandidatesPanel()',c);assert.match(html,/2000-10-14 — 2000-10-20/);assert.match(html,/7 日觀測/);assert.match(html,/AID A/);assert.match(html,/觀測收幣/);assert.match(html,/觀測贈幣/);assert.match(html,/不納入營收/);assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<img>|NaN|undefined/);
 assert.match(vm.runInContext("merchantCandidatesPanel('demo','2000-11')",c),/尚無此期間/);
});
