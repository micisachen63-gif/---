import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app=(await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8')).split('let chartSequence=0;')[0];
function harness(records){const c=vm.createContext({records});vm.runInContext(app+'\nD={registrationPeriods:records,monthly:[{platform:"win",month:"2026-10",registrations:999999}],channels:{periods:[{month:"2026-10",registrations:888888}]}};',c);return c;}
const source=(patch={})=>({platform:'win',from:'2026-10-01',through:'2026-10-20',newRegistered:42,complete:true,validation:{valid:true},capturedAt:'2026-10-21T01:00:00Z',...patch});
const lookup=c=>vm.runInContext('registrationForPeriod("win","2026-10-01","2026-10-20")',c);
test('exact registration scope uses latest validated source and preserves explicit zero',()=>{const c=harness([source(),source({newRegistered:0,capturedAt:'2026-10-21T02:00:00Z'})]);assert.equal(lookup(c).newRegistered,0);});
test('different periods, invalid source and noninteger counts cannot fallback to cohort or retention data',()=>{for(const record of [source({through:'2026-10-19'}),source({from:'2026-09-01'}),source({platform:'bo'}),source({complete:false}),source({validation:{valid:false}}),source({newRegistered:null}),source({newRegistered:2.5}),source({capturedAt:null})])assert.equal(lookup(harness([record])),null);assert.equal(lookup(harness([])),null);});
