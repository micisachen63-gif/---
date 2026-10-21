import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../app/premium-charts.js',import.meta.url),'utf8');
function fixture(values){
 const listeners={},dot={dataset:{focusSeries:'0'},attributes:{},setAttribute(key,value){this.attributes[key]=String(value);}},cursor={setAttribute(){}},focus={setAttribute(){},querySelector:()=>cursor,querySelectorAll:()=>[dot]},tip={style:{},hidden:true};
 const root={dataset:{chart:'plot-1'},isConnected:true,addEventListener:(key,fn)=>{listeners[key]=fn;},querySelector:selector=>selector==='.plot-focus'?focus:selector==='.plot-tooltip'?tip:{},};
 const context=vm.createContext({values,document:{querySelectorAll:()=>[root]},state:{year:2026},esc:v=>String(v),num:(v,d=0)=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})});
 vm.runInContext(source,context);
 const svg=vm.runInContext("chart([{name:'scenario',color:'#d0b67b',values}],values.map((_,i)=>'day-'+i),{height:276})",context);
 const geometry=vm.runInContext("chartStore.get('plot-1').geometry",context);
 return{context,svg,geometry,dot,tip,bind(){vm.runInContext('bindPremiumCharts()',context);},right(){listeners.keydown({key:'ArrowRight',preventDefault(){},target:{closest:()=>({})}});}};
}
function pointYs(svg){return [...svg.matchAll(/<circle class="plot-point"[^>]*cy="([^"]+)"/g)].map(m=>Number(m[1]));}

test('cross-zero revenue stays inside plot, fills to zero and hover dots use the same signed geometry',()=>{
 const f=fixture([200000,-42741.34,null,-70041.94]),g=f.geometry;
 assert(g.min<=-70041.94&&g.max>=200000);assert(g.zeroY>g.pad.t&&g.zeroY<g.base);
 assert(f.svg.includes('class="plot-zero-baseline"'));assert.equal(pointYs(f.svg).length,3);
 assert(pointYs(f.svg).every(y=>y>=g.pad.t&&y<=g.base));
 const polygon=/<polygon points="([^"]+)"/.exec(f.svg)[1].split(' ');assert.equal(Number(polygon[0].split(',')[1]),g.zeroY);assert.equal(Number(polygon.at(-1).split(',')[1]),g.zeroY);
 f.bind();f.right();
 const expected=vm.runInContext("plotY(chartStore.get('plot-1').geometry,-42741.34)",f.context);
 assert.equal(Number(f.dot.attributes.cy),expected);assert.equal(f.dot.attributes.visibility,'visible');assert(f.tip.innerHTML.includes('-42,741.3'));
 f.right();assert.equal(f.dot.attributes.visibility,'hidden','null gaps have no focus dot');
 f.right();assert.equal(f.dot.attributes.visibility,'visible');assert(Number(f.dot.attributes.cy)<=g.base);
});

test('all-negative data has zero at top and null splits paths instead of creating a zero observation',()=>{
 const f=fixture([-10,-25,null,-5]),g=f.geometry;
 assert(g.min<=-25);assert.equal(g.max,0);assert.equal(g.zeroY,g.pad.t);
 assert.equal(pointYs(f.svg).length,3);assert.equal((f.svg.match(/<polyline /g)||[]).length,2);
 assert(pointYs(f.svg).every(y=>y>g.zeroY&&y<=g.base));assert(!f.svg.includes('NaN'));
});

test('nonnegative plots retain their previous zero floor and scale after the shared signed-domain change',()=>{
 const f=fixture([0,100,null,50]),g=f.geometry;
 assert.equal(g.min,0);assert.equal(g.max,200);assert.equal(g.zeroY,g.base);
 const ys=pointYs(f.svg);assert.equal(ys[0],g.base);assert.equal(ys[1],g.base-100/200*(g.h-g.pad.t-g.pad.b));
 assert.equal((f.svg.match(/<polyline /g)||[]).length,2);assert(!f.svg.includes('class="plot-zero-baseline"'));
 f.bind();f.right();assert.equal(Number(f.dot.attributes.cy),ys[1]);
});
