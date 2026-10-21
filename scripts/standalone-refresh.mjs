import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export const PROJECT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PRIVATE=path.join(PROJECT_ROOT,'private');
const TOKEN_PATH=path.join(PRIVATE,'site-service-token.dpapi');

export function redactOutput(value,token){
 let text=String(value);if(token)text=text.split(token).join('[REDACTED]');
 return text.replace(/(OAI-Sites-Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s"}]+/gi,'$1[REDACTED]').replace(/("token"\s*:\s*")[^"]*(")/g,'$1[REDACTED]$2');
}
export function receiptFromOutput(output){
 for(const line of String(output).trim().split(/\r?\n/).reverse()){
  try{const value=JSON.parse(line);if(value.ok===true&&/^[a-f\d]{64}$/.test(value.sha256||'')&&value.verifiedAt&&value.sourceThrough)return value;}catch{}
 }
 throw Error('更新器未傳回完整寫入及讀回驗證回條');
}
async function atomicJson(filename,value){
 const temporary=filename+'.'+process.pid+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2),'utf8');await fs.rename(temporary,filename);
}
export async function decryptToken(tokenPath=TOKEN_PATH){
 if(process.platform!=='win32')throw Error('DPAPI 解密僅支援原 Windows 使用者帳戶');
 await fs.access(tokenPath).catch(()=>{throw Error('缺少 DPAPI 加密的 Site service token，尚未設定獨立更新器');});
 const command="$ErrorActionPreference='Stop';try { Add-Type -AssemblyName System.Security; $cipher=[Convert]::FromBase64String([IO.File]::ReadAllText($env:OPERATIONS_SITE_TOKEN_PATH).Trim()); $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); [Console]::Write([Text.Encoding]::UTF8.GetString($plain)); [Array]::Clear($plain,0,$plain.Length) } catch { exit 1 }";
 return await new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',command],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,OPERATIONS_SITE_TOKEN_PATH:tokenPath}});
  const chunks=[];let bytes=0;const timer=setTimeout(()=>child.kill(),30000);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)child.kill();else chunks.push(chunk);});
  child.on('error',()=>{clearTimeout(timer);reject(Error('無法啟動 Windows DPAPI 解密程序'));});
  child.on('close',code=>{clearTimeout(timer);const buffer=Buffer.concat(chunks);const token=buffer.toString('utf8');buffer.fill(0);for(const c of chunks)c.fill(0);if(code!==0||token.length<10||/[\r\n]/.test(token))reject(Error('DPAPI 解密失敗，請使用加密時相同的 Windows 帳戶'));else resolve(token);});
 });
}
export async function runRefresh(token,{nodePath=process.execPath,timeoutMs=26*60000}={}){
 return await new Promise((resolve,reject)=>{
  // refresh.mjs waits up to 20 minutes for the existing 08:00 collector.
  // The token is absent from argv, environment variables, and disk.
  const child=spawn(nodePath,[path.join(PROJECT_ROOT,'scripts/refresh.mjs')],{cwd:PROJECT_ROOT,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errorOutput='',overflow=false;const collect=(which,chunk)=>{const text=redactOutput(chunk.toString('utf8'),token);if(output.length+errorOutput.length+text.length>5*1024*1024){overflow=true;child.kill();return;}if(which==='out')output+=text;else errorOutput+=text;};
  child.stdout.on('data',chunk=>collect('out',chunk));child.stderr.on('data',chunk=>collect('err',chunk));
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({token}));
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
  child.on('error',()=>{clearTimeout(timer);reject(Error('無法啟動網站更新程序'));});
  child.on('close',code=>{clearTimeout(timer);resolve({code:code??1,output,errorOutput,timedOut,overflow});});
 });
}
export async function standalone(){
 await fs.mkdir(PRIVATE,{recursive:true});const logs=path.join(PRIVATE,'refresh-logs');await fs.mkdir(logs,{recursive:true});
 const startedAt=new Date().toISOString(),logPath=path.join(logs,startedAt.replaceAll(':','-')+'.log'),lastFile=path.join(PRIVATE,'refresh-last.json');
 let token,result;
 await atomicJson(lastFile,{ok:null,status:'running',startedAt,pid:process.pid,logPath});
 try{
  token=await decryptToken();result=await runRefresh(token);
  const log=redactOutput(result.output+'\n'+result.errorOutput,token);await fs.writeFile(logPath,log,'utf8');
  if(result.timedOut)throw Error('更新程序超過26分鐘，已停止；網站沿用上次成功資料');
  if(result.overflow)throw Error('更新程序輸出異常過大，已停止');
  if(result.code!==0){const denied=/HTTP (401|403)\b/.test(log);throw Error(denied?'Site service token 已失效、撤銷或不再授權；未更新網站，需重新確認私人網站存取權':'資料檢查、上傳或讀回驗證失敗；詳見不含憑證的執行紀錄');}
  const receipt=receiptFromOutput(result.output);
  await atomicJson(lastFile,{ok:true,status:'verified',startedAt,finishedAt:new Date().toISOString(),logPath,...receipt});
  console.log(JSON.stringify({ok:true,sourceThrough:receipt.sourceThrough,verifiedAt:receipt.verifiedAt,sha256:receipt.sha256}));
 }catch(error){
  const message=redactOutput(error.message,token);if(!result)await fs.writeFile(logPath,message+'\n','utf8');
  await atomicJson(lastFile,{ok:false,status:'failed',startedAt,finishedAt:new Date().toISOString(),error:message,logPath});
  console.error(JSON.stringify({ok:false,error:message}));process.exitCode=1;
 }finally{token=undefined;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await standalone();
