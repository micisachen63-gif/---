import test from 'node:test';
import assert from 'node:assert/strict';
import {redactOutput,receiptFromOutput} from './standalone-refresh.mjs';
test('紀錄清除原始token與認證欄位，拒絕沒有讀回hash的成功',()=>{
 const token='private-service-value';const log=redactOutput('token='+token+' '+JSON.stringify({token})+' OAI-Sites-Authorization: Bearer '+token,token);
 assert.equal(log.includes(token),false);assert.match(log,/REDACTED/);
 assert.throws(()=>receiptFromOutput('{"ok":true}\n'),/驗證回條/);
 assert.throws(()=>receiptFromOutput('{"ok":false,"sha256":"'+ 'a'.repeat(64)+'"}'),/驗證回條/);
});
test('只接受完整寫入並讀回的最後成功回條',()=>{
 const receipt={ok:true,sha256:'a'.repeat(64),verifiedAt:'2026-10-20T00:10:00Z',sourceThrough:'2026-10-19'};
 assert.deepEqual(receiptFromOutput('waiting for source\n'+JSON.stringify(receipt)+'\n'),receipt);
});
