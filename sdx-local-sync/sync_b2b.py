#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SD x WINMALO: whitelisted Windows computer -> sanitized B2B test ranking API.
Use only on a computer authorized to access the B2B backend. No bypass/proxy is used.
No credentials or AIDs are sent to Render or written to logs.
"""
import argparse
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
import sys
import time
import threading
import queue
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from decimal import Decimal,ROUND_HALF_UP

B2B_BASE = 'https://admin-b2b.winmalo.com:9032/api/'
PUSH_URL = 'https://sdx-winmalo-b2b-ranking-api-2026.onrender.com/api/ingest'
PRIVATE_API_BASE = 'https://sdx-winmalo-b2b-ranking-api-2026.onrender.com'
LOCAL_ZONE = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.local.json'
TOKEN = ROOT / '.sync-token'
STATUS_FILE = ROOT / 'sync-status.json'
VERIFIER_STATUS_FILE = ROOT / 'verifier-status.json'

def set_verifier_status(state, detail=None):
    """Health diagnostics only: never persist submitted AIDs, tokens or session data."""
    obj={'state':state,'updatedAt':datetime.now(timezone.utc).isoformat()}
    if detail:obj['detail']=str(detail)[:80]
    try:
        temp=VERIFIER_STATUS_FILE.with_suffix('.tmp')
        temp.write_text(json.dumps(obj,ensure_ascii=False),encoding='utf-8')
        temp.replace(VERIFIER_STATUS_FILE)
    except OSError:
        pass

def set_status(phase, message=None):
    """Persist non-sensitive progress only; never write passwords, sessions, AIDs or bet records."""
    payload = {'phase':phase, 'updatedAt':datetime.now(timezone.utc).isoformat()}
    if message:
        # Error messages from this client are generic and do not include credentials.
        payload['message'] = str(message).splitlines()[0][:220]
    try:
        STATUS_FILE.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    except OSError:
        pass
MAX_PAGE = 500
PUBLIC_LIMIT = 10

class B2BError(Exception):
    pass

def require(value, message):
    if not value:
        raise B2BError(message)
    return value

def api_result(response):
    if not isinstance(response, dict):
        raise B2BError('B2B 回傳內容不是預期的 JSON 物件。')
    if response.get('status') != 2:
        raise B2BError('B2B 後台未授權或拒絕請求（狀態：%s）。' % response.get('status'))
    return response.get('data')

class Backend:
    def __init__(self, account, password):
        self.account = require(account, '請填寫 B2B 帳號')
        self.password = require(password, '請輸入 B2B 密碼')
        self._call_lock=threading.RLock()
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.login()

    def request(self, endpoint, body):
        req = urllib.request.Request(B2B_BASE + endpoint,
            data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'SDX-Local-Event-Sync/1.0'},
            method='POST')
        try:
            with self.opener.open(req, timeout=25) as response:
                raw = response.read(8*1024*1024 + 1)
                if len(raw)>8*1024*1024:
                    raise B2BError('B2B 回應太大；已停止避免漏資料。')
                return json.loads(raw.decode('utf-8'))
        except urllib.error.HTTPError as exc:
            raise B2BError('B2B HTTP 錯誤 %s，請確認 IP 白名單與登入權限。' % exc.code) from None
        except urllib.error.URLError as exc:
            raise B2BError('無法從本機連接 B2B API，請確認 IP 白名單、DNS、VPN 及 9032 埠。') from None
        except (TimeoutError,ConnectionResetError,ConnectionAbortedError):
            raise B2BError('B2B 後台請求超時或連線中斷，請確認白名單網路及後台狀態。') from None
        except json.JSONDecodeError:
            raise B2BError('B2B 回傳 HTML 或非 JSON；可能需要網頁登入、授權或不同 API。') from None

    def login(self):
        result = self.request('login', {'account':self.account,'password':self.password})
        if not isinstance(result,dict) or result.get('status') != 'success':
            raise B2BError('B2B 登入未成功，請檢查帳密、白名單或額外驗證。')
        if not list(self.cookies):
            raise B2BError('登入未得到有效 session cookie；請檢查 B2B API 登入流程。')

    def call(self, endpoint, args):
        # A single authenticated B2B session is shared by both leaderboard
        # collection and AID verification. A second login could invalidate
        # the active backend session. Serialize B2B calls, never the heartbeat.
        with self._call_lock:
            try:
                return api_result(self.request(endpoint, args))
            except B2BError as e:
                if '401' in str(e):
                    self.login()
                    return api_result(self.request(endpoint, args))
                raise

    def discover(self):
        vendors = self.call('gameSTMT/vendorList', {})
        if not isinstance(vendors,list):
            raise B2BError('gameSTMT/vendorList 回應結構不符，無法辨識廠商。')
        print('\n【後台廠商】')
        for v in vendors:
            if isinstance(v,dict):
                print('  vendorId=%s | %s' % (v.get('id'),str(v.get('description') or v.get('name') or '')[:100]))
        return vendors

    def games(self, vendor_id):
        data=self.call('gameSTMT/vendorGameList', {'vendorId': int(vendor_id)})
        if not isinstance(data,list):
            raise B2BError('gameSTMT/vendorGameList 回應結構不符。')
        print('\n【後台機台】 vendorId=%s' % vendor_id)
        for v in data:
            if isinstance(v,dict):
                print('  gameName=%s | %s' % (v.get('name'),str(v.get('description') or '')[:100]))
        return data

def read_config():
    if not CONFIG.exists():
        return {}
    cfg=json.loads(CONFIG.read_text('utf-8'))
    if not isinstance(cfg,dict):
        raise B2BError('config.local.json 必須為 JSON 物件。')
    return cfg

def config_check(cfg):
    vendor=cfg.get('vendorId')
    games=cfg.get('games') or {}
    start=cfg.get('startTW')
    if vendor is None or not str(vendor).isdigit():
        raise B2BError('請在 config.local.json 填入透過 --discover 查到的 vendorId。')
    if not all(isinstance(games.get(k),str) and games[k] for k in ('SET2','THOR')):
        raise B2BError('請在 config.local.json 的 games.SET2 及 games.THOR 填入後台 gameName。')
    if not isinstance(start,str):
        raise B2BError('請設定本次活動測試的 startTW（YYYY/MM/DD HH:mm:ss），不可沿用舊活動時間。')
    try:
        start_time=datetime.strptime(start,'%Y/%m/%d %H:%M:%S').replace(tzinfo=LOCAL_ZONE)
    except ValueError:
        raise B2BError('startTW 應是 YYYY/MM/DD HH:mm:ss 格式。') from None
    if start_time>datetime.now(LOCAL_ZONE):
        raise B2BError('startTW 不可為未來時間；測試請使用實際測試起點。')
    return int(vendor),games,start_time

def positive(value):
    if value is None or isinstance(value,bool):
        return None
    try:
        num=float(str(value).replace(',',''))
        return num if 0<=num<1e18 and num==num else None
    except (TypeError,ValueError,OverflowError):
        return None

def row_key(row):
    for key in ('aId','aid','a_id','AID','playerAID'):
        if row.get(key) not in (None,''):
            return str(row[key])
    return None

def nickname(row):
    for key in ('nickname','playerName','name'):
        value=row.get(key)
        if value:
            clean=''.join(c for c in str(value).strip() if ord(c)>=32)
            return clean[:32] or '匿名玩家'
    return '匿名玩家'

def parse_time(value):
    if value is None: raise B2BError('注單缺少時間欄位，無法確認活動期間。')
    if isinstance(value,(int,float)) or str(value).isdigit():
        number=float(value)
        if number>1e12: number/=1000
        return datetime.fromtimestamp(number,LOCAL_ZONE)
    for fmt in ('%Y/%m/%d %H:%M:%S','%Y-%m-%d %H:%M:%S','%Y-%m-%dT%H:%M:%S'):
        try: return datetime.strptime(str(value)[:19],fmt).replace(tzinfo=LOCAL_ZONE)
        except ValueError: continue
    raise B2BError('B2B 時間欄位格式未確認，停止同步：'+type(value).__name__)

def date_arg(dt): return dt.strftime('%Y/%m/%d %H:%M:%S')
def date_day(dt): return dt.strftime('%Y/%m/%d')

def unwrap_player_rows(data):
    if isinstance(data,list):return data
    if isinstance(data,dict) and isinstance(data.get('data'),list):return data['data']
    raise B2BError('個人報表格式未知，不能把未知欄位當有效押碼。')

def official_bet_field(row):
    for key in ('validBet','effective_bet','effectiveBet','validBetAmount'):
        if key in row: return key
    return None


def normalize_leaders(total_by_user, names, include_aid=False):
    values=[(user,score) for user,score in total_by_user.items() if score>0]
    values.sort(key=lambda x:(-x[1],x[0]))
    output=[]
    for i,(user,score) in enumerate(values[:PUBLIC_LIMIT]):
        row={'rank':i+1,'nickname':names.get(user,'匿名玩家'),'score':round(score,4)}
        if include_aid:row['aid']=user
        output.append(row)
    return output


def receiver_api(path, payload=None):
    """Authenticated server-to-server requests. Secrets never go to stdout."""
    secret=require(TOKEN.read_text('utf-8').strip() if TOKEN.exists() else '',
                   '本機缺少 .sync-token，同步金鑰尚未設定。')
    if not path.startswith('/api/verifier/'):
        raise B2BError('拒絕非白名單接收端點。')
    method='POST' if payload is not None else 'GET'
    request=urllib.request.Request(PRIVATE_API_BASE+path,
        data=json.dumps(payload,separators=(',',':')).encode('utf8') if payload is not None else None,
        headers={'Authorization':'Bearer '+secret,'Accept':'application/json','Content-Type':'application/json'},
        method=method)
    try:
        with urllib.request.urlopen(request,timeout=22) as response:
            obj=json.loads(response.read(256*1024).decode('utf8'))
            if not isinstance(obj,dict):
                raise B2BError('接收端回應格式錯誤。')
            return obj
    except urllib.error.HTTPError as exc:
        raise B2BError('活動接收端 HTTP '+str(exc.code)+'；請檢查驗證金鑰與 Google Sheets 設定。') from None
    except urllib.error.URLError:
        raise B2BError('本機無法連接活動驗證 API。') from None
    except json.JSONDecodeError:
        raise B2BError('活動接收端回應不是 JSON。') from None

def verify_exists_on_b2b(api,aid):
    """玩家管理 > 會員管理 > searchBy=0 (a_id).
    Only an exact backend a_id match counts as a registered B2B account.
    Do not confuse 'no game bets in activity window' with 'AID does not exist'.
    """
    aid=str(aid).strip()
    if not aid.isdigit() or not (6<=len(aid)<=20):
        raise B2BError('待驗證 AID 格式不合法。')
    page,limit=1,50
    while True:
        if page>10:
            raise B2BError('會員查詢結果過多，無法安全確認指定 AID。')
        data=api.call('player/list',{'searchBy':'0','searchContent':aid,'page':page,'limit':limit})
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):
            raise B2BError('會員管理查詢回應格式不符，不可直接核准登記。')
        rows=data['data']
        total=positive(data.get('total'))
        if total is None or int(total)!=total:
            raise B2BError('會員管理查詢沒有可靠的 total 筆數。')
        for row in rows:
            if not isinstance(row,dict):
                raise B2BError('會員管理資料格式不符。')
            actual=row.get('a_id',row.get('aId'))
            if actual is not None and str(actual)==aid:
                return True
        if (page-1)*limit+len(rows)>=int(total) or not rows:
            return False
        page+=1

def verified_registration_aids(with_event=False):
    """Only AIDs actually registered in the event Google Sheet."""
    obj=receiver_api('/api/verifier/aids')
    if obj.get('ok') is not True or obj.get('eventCode')!='DUAL2026' or not isinstance(obj.get('aids'),list):
        raise B2BError('Google 試算表登記名單尚未可用，不發布未確認資格的榜單。')
    event=obj.get('event')
    if (not isinstance(event,dict) or event.get('phase') not in ('CCB','READY','SCHEDULED','OFFICIAL','ENDED') or
        isinstance(event.get('epoch'),bool) or not isinstance(event.get('epoch'),int) or event['epoch']<1):
        raise B2BError('活動世代或 CCB 狀態無法確認，已停止資料發布。')
    if event['phase'] in ('SCHEDULED','OFFICIAL','ENDED') and (not isinstance(event.get('startTW'),str) or not isinstance(event.get('endTW'),str)):
        raise B2BError('正式活動起算時間未確認，已停止資料發布。')
    values=[]
    for aid in obj['aids']:
        if not isinstance(aid,str) or not aid.isdigit() or not (6<=len(aid)<=20):
            raise B2BError('活動登記表出現格式不符的 AID。')
        if aid not in values:values.append(aid)
        if len(values)>200:raise B2BError('登記人數超過目前核對上限 200 人。')
    # The local CSV is a private cache only, never treated as the source of truth.
    temp=ROOT/'registered_aids.tmp'
    try:
        temp.write_text('AID\n'+'\n'.join(values)+('\n' if values else ''),encoding='utf-8')
        temp.replace(ROOT/'registered_aids.csv')
    except OSError:
        pass
    print('  已從 Google Sheets 取得當期有效登記 AID %d 筆（不輸出 AID）。' % len(values))
    return (values,event) if with_event else values

def verifier_poller(stop, job_queue, queued, queued_lock):
    """Independent 5-second heartbeat so long B2B queries never take signups offline.

    Only this thread contacts /api/verifier/jobs. It does NOT re-login to B2B,
    does NOT query player data and cannot be blocked by report calculations.
    """
    first_success=False
    errors=0
    while not stop.is_set():
        try:
            received=receiver_api('/api/verifier/jobs')
            if received.get('ok') is not True or not isinstance(received.get('jobs'),list):
                raise B2BError('活動驗證工作清單格式無效。')
            errors=0
            set_verifier_status('online')
            if not first_success:
                print('✓ AID 即時驗證心跳已連線；每 5 秒確認一次 Render。',flush=True)
                first_success=True
            if isinstance(received.get('event'),dict) and received['event'].get('phase')=='READY':
                cache=ROOT/'registered_aids.csv'
                temp=ROOT/'registered_aids.reset.tmp'
                if cache.exists() and cache.read_text('utf-8-sig').strip()!='AID':
                    try:
                        temp.write_text('AID\n',encoding='utf-8')
                        temp.replace(cache)
                        print('✓ CCB 已清場：本機登記 AID 快取已清空。',flush=True)
                    except OSError:
                        print('  CCB 已清場，但本機快取暫時無法清除。',flush=True)
            for item in received['jobs']:
                if not isinstance(item,dict) or not isinstance(item.get('requestId'),str):
                    continue
                request_id=item['requestId']
                aid=item.get('aid')
                if not isinstance(aid,str) or not (6<=len(aid)<=20) or not aid.isdigit():
                    continue
                with queued_lock:
                    if request_id in queued:
                        continue
                    try:
                        job_queue.put_nowait((request_id,aid))
                        queued.add(request_id)
                    except queue.Full:
                        # Server resends after 30 seconds, never silently
                        # approves a B2B account that was not checked.
                        print('  AID 驗證佇列已滿，將等待後台重送。',flush=True)
            stop.wait(5)
        except Exception as exc:
            # Avoid silent death of heartbeat thread, and never log request
            # bodies, cookies, AIDs, passwords or server response payload.
            errors+=1
            kind=type(exc).__name__
            set_verifier_status('reconnecting',kind)
            if first_success or errors==1 or errors%5==0:
                print('  AID 即時驗證連線中斷（%s），將自動重連；排行榜不受影響。' % kind,flush=True)
            first_success=False
            stop.wait(5 if errors<3 else 10)
    set_verifier_status('stopped')


def verifier_job_worker(api, stop, job_queue, queued, queued_lock):
    """Verify only exact B2B membership matches; heartbeat runs in parallel."""
    while not stop.is_set():
        try:
            request_id,aid=job_queue.get(timeout=1)
        except queue.Empty:
            continue
        try:
            exists=verify_exists_on_b2b(api,aid)
            reply=receiver_api('/api/verifier/result',
                {'requestId':request_id,'exists':exists})
            print('  AID 後台確認：%s；登記回覆：%s' %
                ('存在' if exists else '不存在',str(reply.get('status','未完成'))[:36]),flush=True)
        except Exception as exc:
            # An inaccessible B2B service is NOT a nonexistent AID.
            try:
                receiver_api('/api/verifier/result',{'requestId':request_id,'error':True})
            except Exception:
                pass
            print('  AID 後台查詢未成功（%s），未核准登記。' % type(exc).__name__,flush=True)
        finally:
            with queued_lock:queued.discard(request_id)
            job_queue.task_done()


def registered_aids(cfg):
    """Current-event AIDs only. Never import last event's registrations automatically."""
    source=cfg.get('registrationFile') or 'registered_aids.csv'
    file_path=Path(source)
    if not file_path.is_absolute():
        file_path=ROOT/file_path
    if not file_path.exists():
        print('  尚無本次活動 AID 名單：%s，暫時只展示總投注額測試榜，倍率榜停用。' % file_path.name)
        return []
    values=[]
    for line in file_path.read_text(encoding='utf-8-sig').splitlines():
        line=line.split(',')[0].strip().strip('"').strip("'")
        if not line or line.lower() in ('aid','a_id','a-id') or line.startswith('#'):
            continue
        if not line.isdigit() or not (4<=len(line)<=20):
            raise B2BError('登記名單存在格式不符的 AID；請核對 %s。' % file_path.name)
        if line not in values:
            values.append(line)
        if len(values)>200:
            raise B2BError('登記 AID 超過 200 人，請分批核對後再同步。')
    if not values:
        print('  登記名單尚未填入 AID；倍率榜會標記待同步，不會混入未登記玩家。')
    else:
        print('  已讀取本次活動登記 AID：%s 筆（不輸出 AID）。' % len(values))
    return values

def machine_rtp_from_player_data(summary):
    """Backend 玩家數據: weighted RTP = sum(pay) / sum(bet) * 100.

    Includes all players of THIS selected machine during the same event period,
    regardless of registration; public snapshot only carries the percentage.
    """
    if not isinstance(summary,list):
        raise B2BError('RTP 玩家數據必須是後台陣列。')
    total_bet,total_pay=0.0,0.0
    for row in summary:
        if not isinstance(row,dict) or 'bet' not in row or 'pay' not in row:
            raise B2BError('RTP 缺少 B2B 官方 bet 或 pay 欄位，不發布猜測值。')
        bet,pay=positive(row['bet']),positive(row['pay'])
        if bet is None or pay is None:
            raise B2BError('RTP 來源含非法投注額或出分數字，不發布猜測值。')
        total_bet+=bet
        total_pay+=pay
    if total_bet<=0:
        return None  # No bets: not 0%, not a hypothetical RTP.
    return round(100.0*total_pay/total_bet,2)


def build_luckboard_for_all(summary, registered):
    """Game report per-player betCount, bet and pay; no AID in published rows.

    Registered users only. A zero-bet entry has RTP=None and is never ranked as 0%.
    Returns private AID-indexed aggregates for safe cross-machine joining.
    """
    if not isinstance(summary,list):
        raise B2BError('神運榜後台玩家資料不是陣列。')
    valid=set(registered)
    players={}
    for row in summary:
        if not isinstance(row,dict):
            raise B2BError('神運榜玩家資料格式不符。')
        user=row_key(row)
        if not user:
            raise B2BError('神運榜缺少後台玩家 AID。')
        if user not in valid:
            continue
        if user in players:
            raise B2BError('神運榜玩家 AID 重複，禁止雙重累計。')
        for key in ('betCount','bet','pay'):
            if key not in row:
                raise B2BError('神運榜缺少官方欄位：'+key)
        turns=positive(row['betCount'])
        bet=positive(row['bet'])
        pay=positive(row['pay'])
        if turns is None or int(turns)!=turns or bet is None or pay is None:
            raise B2BError('神運榜後台轉數、投注額或出分出現非法數值。')
        players[user]={'nickname':nickname(row),'spins':int(turns),'bet':bet,'pay':pay}
    return players

def luckboard_sorted(entries,registered):
    """Public ranks ordered by RTP descending, then total bet, then spins."""
    board=[]
    for aid in registered:
        data=entries.get(aid)
        if not data:
            data={'nickname':'尚無遊戲紀錄','spins':0,'bet':0,'pay':0}
        bet=float(data['bet'])
        pay=float(data['pay'])
        rtp=round(100*pay/bet,2) if bet>0 else None
        board.append({'nickname':data['nickname'],'spins':int(data['spins']),
                      'bet':round(bet,2),'rtp':rtp})
    board.sort(key=lambda row:(row['rtp'] is None,
                               -(row['rtp'] or 0),-row['bet'],-row['spins'],
                               row['nickname']))
    for index,row in enumerate(board):
        row['rank']=index+1 if row['rtp'] is not None else None
    return board

def merge_luckboard(a,b,registered):
    """Merge two machines by internal AID; never combine players by nickname."""
    merged={}
    for source in (a,b):
        for aid,row in source.items():
            existing=merged.get(aid)
            if existing is None:
                merged[aid]=dict(row)
            else:
                existing['spins']+=row['spins']
                existing['bet']+=row['bet']
                existing['pay']+=row['pay']
                if existing['nickname']=='匿名玩家':
                    existing['nickname']=row['nickname']
    return luckboard_sorted(merged,registered)

def summary_bet_rankings(summary, aids, restrict_registered=False):
    """遊戲報表 > 玩家數據: the UI column 總投注額 is API field bet."""
    if not isinstance(summary,list):
        raise B2BError('玩家數據回應不是資料陣列。')
    totals={}
    names={}
    allowed=set(aids) if (aids or restrict_registered) else None
    for row in summary:
        if not isinstance(row,dict):
            raise B2BError('玩家數據包含非預期資料。')
        user=row_key(row)
        if not user:
            raise B2BError('玩家數據缺少 AID，無法正確去重。')
        if user in totals:
            raise B2BError('玩家數據重複 AID，無法判斷是否為合計數字。')
        if 'bet' not in row:
            raise B2BError('玩家數據缺少官方「總投注額 bet」欄位。')
        score=positive(row['bet'])
        if score is None:
            raise B2BError('玩家總投注額存在不合法數值。')
        totals[user]=score
        names[user]=nickname(row)
    if allowed is not None:
        totals={user:value for user,value in totals.items() if user in allowed}
    return normalize_leaders(totals,names),names,totals

def find_account_game_id(api,vendor,game_name):
    """帳號查詢 uses /tools/vendorGameList numeric ID, not the player's gameName."""
    data=api.call('tools/vendorGameList',{'vendorId':vendor})
    if not isinstance(data,list):
        raise B2BError('帳號查詢機台清單格式無法確認。')
    matches=[g for g in data if isinstance(g,dict)
             and str(g.get('name',''))==str(game_name) and g.get('id') not in ('',None)]
    if len(matches)!=1:
        raise B2BError('帳號查詢機台 ID 無法唯一對應到 %s，請使用 --inspect 檢查。' % game_name)
    return str(matches[0]['id'])

def account_time(value):
    # 帳號查詢的時間欄位使用 time；不能用查詢日期代替實際注單日期。
    return parse_time(value)

def _scan_account_multiplier(api,vendor,game_id,start,stop,aid,page_limit):
    page=1
    fetched=0
    expected_total=None
    seen=set()
    best=0.0
    while True:
        if page>MAX_PAGE:
            raise B2BError('帳號查詢超過分頁上限，禁止發布不完整倍率榜。')
        args={
            'page':page,'limit':page_limit,'a_id':aid,
            'start':start.strftime('%Y-%m-%d %H:%M:%S'),
            'stop':stop.strftime('%Y-%m-%d %H:%M:%S'),
            'pay':0,'vendor_id':str(vendor),'game_id':str(game_id)
        }
        data=api.call('gameSTMT/searchAccountSTMT',args)
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):
            raise B2BError('帳號查詢 API 欄位格式不符；未確認時不可使用倍率。')
        rows=data['data']
        total=positive(data.get('total'))
        if total is None or int(total)!=total:
            raise B2BError('帳號查詢缺少可靠的 total 分頁總數。')
        if expected_total is None:expected_total=int(total)
        elif expected_total!=int(total):
            raise B2BError('帳號查詢分頁數據在同步期間變動，請重新整理。')
        if page_limit>100 and (len(rows)>page_limit or (fetched+len(rows)<expected_total and len(rows)!=page_limit)):
            raise B2BError('大分頁回傳筆數不符，改用原始分頁。')
        fetched+=len(rows)
        if fetched>expected_total:
            raise B2BError('帳號查詢分頁記錄數超出 total；資料重複或格式變更。')
        for row in rows:
            if not isinstance(row,dict):
                raise B2BError('帳號查詢出現非預期的注單格式。')
            observed=row.get('a_id',row.get('aId'))
            if observed is None or str(observed)!=aid:
                raise B2BError('帳號查詢回傳非指定 AID 的資料，已取消同步。')
            doc=row.get('docNo')
            if not doc:
                raise B2BError('帳號查詢缺少 docNo，無法排除重複單號。')
            if str(doc) in seen:
                if page_limit>100:raise B2BError('大分頁注單重複，改用原始分頁。')
                continue
            seen.add(str(doc))
            stamp=account_time(row.get('time'))
            if stamp<start or stamp>stop:continue
            if 'xpay' not in row:
                raise B2BError('帳號查詢缺少後台官方倍率欄位 xpay。')
            mul=positive(row['xpay'])
            if mul is None and row['xpay'] not in ('',None):
                raise B2BError('帳號查詢官方倍率包含不合法數值。')
            if mul is not None:
                best=max(best,mul)
        if fetched>=expected_total:break
        if not rows:
            raise B2BError('帳號查詢分頁提前結束，禁止發布不完整倍率榜。')
        page+=1
        if page%10==0:print('    倍率分頁進度：第 %d 頁' % page,flush=True)
    return best


def account_multiplier_rankings(api,vendor,game_id,game_name,start,stop,aids,names,return_raw=False):
    """Complete official xpay scan every cycle; larger pages fall back to legacy 100."""
    highest={}
    page_limit=200
    for idx,aid in enumerate(aids):
        print('  倍率核對進度：%d / %d 人' % (idx,len(aids)),flush=True)
        try:
            best=_scan_account_multiplier(api,vendor,game_id,start,stop,aid,page_limit)
        except B2BError:
            if page_limit==100:raise
            page_limit=100
            print('  大分頁未通過核對，改用原本每頁 100 筆重新查詢。',flush=True)
            best=_scan_account_multiplier(api,vendor,game_id,start,stop,aid,page_limit)
        if best>0:
            highest[aid]=best
    leaders=normalize_leaders(highest,names)
    return (leaders,highest) if return_raw else leaders


def sync_one_game(api,vendor,game,start,stop,aids,include_multiplier=True,restrict_registered=False,include_admin=False):
    payload={'advertiserId':None,'vendorId':vendor,'gameName':game,
             'start':date_arg(start),'stop':date_arg(stop)}
    summary=unwrap_player_rows(api.call('gameSTMT/vendorGamePlayerSTMT',payload))
    # Use all-player rows for machine RTP BEFORE filtering registration-eligible rankers.
    machine_rtp=machine_rtp_from_player_data(summary)
    bet,names,totals=summary_bet_rankings(summary,aids,restrict_registered=restrict_registered)
    # Capture all registered participants for the luck board (including zero-bet rows)
    # using B2B's documented betCount/bet/pay, before emitting sanitized data.
    luck_players=build_luckboard_for_all(summary,aids)
    print('  玩家數據使用 B2B「總投注額 bet」欄位，非「有效投注額 validBet」。')
    private={'BET':normalize_leaders(totals,names,include_aid=True),
             'MULT':[],
             'ACH':[{'aid':aid,'nickname':row['nickname'],'bet':round(row['bet'],4)}
                    for aid,row in luck_players.items() if row['bet']>=80000]}
    private['ACH'].sort(key=lambda row:(-row['bet'],row['aid']))
    if not aids or not include_multiplier:
        result=(bet,[],False,{'players':len(summary),'registrants':len(aids),'account_queries':0},machine_rtp,luck_players)
        return result+(private,) if include_admin else result
    game_id=find_account_game_id(api,vendor,game)
    if include_admin:
        mult,highest=account_multiplier_rankings(api,vendor,game_id,game,start,stop,aids,names,return_raw=True)
        private['MULT']=normalize_leaders(highest,names,include_aid=True)
    else:
        mult=account_multiplier_rankings(api,vendor,game_id,game,start,stop,aids,names)
    result=(bet,mult,True,{'players':len(summary),'registrants':len(aids),'account_queries':len(aids)},machine_rtp,luck_players)
    return result+(private,) if include_admin else result


# Bankrupt detection is based on the B2B member wallet, not wager losses.
BANKRUPT_ORDER_FILE=ROOT/'bankrupt_order.local.json'
# Verified in the actual Winmalo Admin player-list UI: 金幣 => money,
# 洗碼限制 => junket_quota. Never infer a balance from junket_quota.
BALANCE_FIELDS=('money',)

def parse_member_balance(raw):
    if raw is None or raw=='' or isinstance(raw,bool):return None
    try:amount=float(str(raw).replace(',',''))
    except (TypeError,ValueError,OverflowError):return None
    if not (-1e12<=amount<=1e12):return None
    return amount

def member_coin_balance(api,aid,field=None):
    """Read the currently registered user's exact wallet coin balance."""
    page,limit=1,50
    found=None
    while page<=10:
        data=api.call('player/list',{'searchBy':'0','searchContent':str(aid),'page':page,'limit':limit})
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):
            raise B2BError('會員餘額查詢格式未知。')
        total=positive(data.get('total'))
        if total is None or int(total)!=total:
            raise B2BError('會員餘額查詢缺少可信 total。')
        rows=data['data']
        for row in rows:
            if not isinstance(row,dict):raise B2BError('會員餘額列格式不符。')
            actual=row.get('a_id',row.get('aId'))
            if actual is not None and str(actual)==str(aid):
                if found is not None:raise B2BError('會員查詢重複 AID。')
                found=row
        if (page-1)*limit+len(rows)>=int(total):break
        if not rows:raise B2BError('會員餘額查詢提前出現空頁。')
        page+=1
    if page>10 or found is None:
        raise B2BError('會員餘額查詢找不到唯一、完整的已登記 AID。')
    if field and field!='money':
        raise B2BError('memberBalanceField 必須對應 Winmalo 後台金幣欄位 money，不能使用其他儲值或洗碼欄位。')
    balance=parse_member_balance(found.get('money'))
    if balance is None:
        raise B2BError('B2B 會員金幣 money 欄位缺失或金額格式無效，暫停破產判定。')
    return balance,nickname({'nickname':found.get('nickname')})

def read_bankrupt_order(epoch):
    try:
        state=json.loads(BANKRUPT_ORDER_FILE.read_text(encoding='utf-8'))
        if state.get('eventEpoch')==epoch and isinstance(state.get('sequence'),list):
            seq=state['sequence']
            if len(seq)<=200 and all(isinstance(a,str) and a.isdigit() for a in seq) and len(seq)==len(set(seq)):
                return list(seq)
    except (OSError,ValueError,TypeError,AttributeError):pass
    return []

def save_bankrupt_order(epoch,sequence):
    temp=BANKRUPT_ORDER_FILE.with_suffix('.pending')
    try:
        temp.write_text(json.dumps({'eventEpoch':epoch,'sequence':sequence},ensure_ascii=False),encoding='utf-8')
        temp.replace(BANKRUPT_ORDER_FILE)
    except OSError:
        print('  破產順序快取無法寫入；下輪重新嘗試。')

def build_bankruptcy_board(api,registered,event,per_game,cfg,save_order=True,include_wealth=False):
    """Use ONE verified B2B wallet lookup per registered AID for both lists.

    Bankruptcy uses the historic first-detected ordering, while wealth always
    sorts the current wallet balance descending. Never expose full AID/name or
    turn a missing wallet into a fabricated value.
    """
    total=len(registered)
    def result(bankruptcy,wealth):
        return (bankruptcy,wealth) if include_wealth else bankruptcy
    empty_wealth={'status':'ready','total':0,'checked':0,'rows':[]}
    if not total:
        return result({'status':'ready','total':0,'checked':0,'count':0,'percentage':0,'rows':[]},empty_wealth)
    seq=read_bankrupt_order(event['epoch'])
    found={}
    wealth_private=[]
    try:
        for i,aid in enumerate(registered):
            if i==0 or i%10==0:
                print('  金幣餘額核對進度：%d / %d 人（同時統計破產榜與財富榜）' % (i,total),flush=True)
            balance,name=member_coin_balance(api,aid,cfg.get('memberBalanceField'))
            net=[]
            for code in ('SET2','THOR'):
                game=per_game.get(code,{}).get(aid)
                net.append(round(float(game['pay'])-float(game['bet']),2) if game else 0.0)
                if game and name=='匿名玩家':name=game['nickname']
            public={'aidMasked':'*'*(len(aid)-4)+aid[-4:],
                    'nickname':name,'balance':balance,'setNet':net[0],'thorNet':net[1]}
            wealth_private.append((aid,public))
            if Decimal(str(balance))<Decimal('1'):
                if aid not in seq:seq.append(aid)
                found[aid]=dict(public,ordinal=seq.index(aid)+1)
    except B2BError as exc:
        print('  會員餘額查詢未完成：破產榜、財富榜都暫停更新：'+str(exc))
        return result(
            {'status':'unavailable','total':total,'checked':0,'count':None,'percentage':None,'rows':[]},
            {'status':'unavailable','total':total,'checked':0,'rows':[]})
    if save_order:save_bankrupt_order(event['epoch'],seq)
    bankrupt_rows=sorted(found.values(),key=lambda item:item['ordinal'])
    for i,row in enumerate(bankrupt_rows):row['rank']=i+1
    pct=float((Decimal(len(bankrupt_rows))*Decimal(100)/Decimal(total))
              .quantize(Decimal('0.01'),rounding=ROUND_HALF_UP))
    rich_rows=[]
    for i,(_aid,public) in enumerate(sorted(wealth_private,key=lambda item:
            (-Decimal(str(item[1]['balance'])),item[0]))):
        rich_rows.append(dict(public,rank=i+1))
    return result(
        {'status':'ready','total':total,'checked':total,
         'count':len(bankrupt_rows),'percentage':pct,'rows':bankrupt_rows},
        {'status':'ready','total':total,'checked':total,'rows':rich_rows})

def inspect_balance_fields(api,cfg):
    aids=verified_registration_aids()
    # Field names can be inspected on the first accessible row even before
    # any CCB player registered. No account identity or amount is printed.
    if aids:
        data=api.call('player/list',{'searchBy':'0','searchContent':aids[0],'page':1,'limit':50})
    else:
        data=api.call('player/list',{'searchBy':'0','searchContent':'','page':1,'limit':1})
    if not isinstance(data,dict) or not isinstance(data.get('data'),list):
        raise B2BError('會員列表回傳格式尚未確認。')
    matched=[row for row in data['data'] if isinstance(row,dict) and
             (not aids or str(row.get('a_id',row.get('aId','')))==aids[0])]
    if not matched:raise B2BError('會員列表沒有可檢查的資料列。')
    if aids and len(matched)!=1:raise B2BError('沒有唯一匹配的已登記會員。')
    print('會員列表欄位名稱（不輸出個資或金額）：',sorted(matched[0].keys()))
    print('候選金幣欄位：',[key for key in BALANCE_FIELDS if key in matched[0]])
    print('Winmalo Admin 已確認：金幣欄位 key=money，洗碼限制 key=junket_quota；請勿混用。')

def create_snapshot(api,cfg):
    vendor,games,start=config_check(cfg)
    stop=datetime.now(LOCAL_ZONE)
    if not cfg.get('requireVerifiedRegistrations',True):
        raise B2BError('CCB 切正式時必須只計算 Google 已登記者，不能從舊名單回填。')
    print('【進度 1/4】正在取得 Google Sheets 已驗證的活動 AID 名單...',flush=True)
    aids,event=verified_registration_aids(with_event=True)
    print('  已取得當期活動階段：%s；已登記 %d 人。' % (event['phase'],len(aids)),flush=True)
    if event['phase']=='READY':
        raise B2BError('CCB 已清場，等待管理員手動啟動正式活動；不會回填 CCB 數據。')
    if event['phase']=='SCHEDULED':
        raise B2BError('正式活動已排程，尚未到設定的開始時間；不進行提前統計。')
    if event['phase']=='ENDED':
        raise B2BError('本次活動已結束，已停止 B2B 及 Google Sheets 同步；網站保留封存榜單。')
    if event['phase']=='OFFICIAL':
        try:
            start=datetime.strptime(event['startTW'],'%Y/%m/%d %H:%M:%S').replace(tzinfo=LOCAL_ZONE)
            end=datetime.strptime(event['endTW'],'%Y/%m/%d %H:%M:%S').replace(tzinfo=LOCAL_ZONE)
        except (ValueError,KeyError):
            raise B2BError('正式活動起訖時間格式錯誤，禁止沿用 CCB 期間統計。') from None
        if start>=end or stop>=end:
            raise B2BError('本次活動結束時間已到，停止同步，使用網站封存的最後有效資料。')
        if start>stop:
            raise B2BError('正式活動尚未開始，不可使用 CCB 時間作為投注起點。')
    if (stop-start).total_seconds()>45*86400:
        raise B2BError('單次同步最多 45 天；請確認活動統計起點。')
    ranks={}
    count={}
    rtp={}
    luck_players={}
    multiplier_ok=True
    admin_ledger={}
    for code in ('SET2','THOR'):
        print('【進度 2/4】正在讀取 %s 機台及會員倍率（B2B 查詢時間依注單量而定）...' % code,flush=True)
        print('讀取 %s（後台 gameName=%s）…' % (code,games[code]),flush=True)
        bet,mult,valid,stat,rtp_value,per_player,admin=sync_one_game(
            api,vendor,games[code],start,stop,aids,
            restrict_registered=cfg.get('requireVerifiedRegistrations',True),include_admin=True)
        admin_ledger[code]=admin
        luck_players[code]=per_player
        rtp[code]=rtp_value
        ranks[code]={'BET':bet,'MULT':mult}
        count[code]=stat
        multiplier_ok=multiplier_ok and valid
        print('  押碼榜 %s 人，倍率榜 %s 人；RTP %s；已核對 %s' % (len(bet),len(mult),str(rtp_value)+'%' if rtp_value is not None else '尚無可計算資料',stat))
    luckboard={
        'ALL':merge_luckboard(luck_players.get('SET2',{}),luck_players.get('THOR',{}),aids),
        'SET2':luckboard_sorted(luck_players.get('SET2',{}),aids),
        'THOR':luckboard_sorted(luck_players.get('THOR',{}),aids)
    }
    print('【進度 3/4】正在核對已登記會員的金幣餘額與破產榜...',flush=True)
    bankruptcy,wealth=build_bankruptcy_board(api,aids,event,luck_players,cfg,include_wealth=True)
    print('  財富榜：%s 人的會員餘額已完成驗證。' % (wealth['checked']),flush=True)
    print('【進度 4/4】已建立官網榜單和後勤派獎帳本，準備送出。',flush=True)
    return {
        'version':1,'source':'local-whitelisted-b2b',
        'lastUpdated':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'eventEpoch':event['epoch'],'eventPhase':event['phase'],
        'eventStartTW':event.get('startTW','') if event['phase']=='OFFICIAL' else '',
        'eventEndTW':event.get('endTW','') if event['phase']=='OFFICIAL' else '',
        'rankings':ranks,'rtp':rtp,'luckboard':luckboard,'bankruptcy':bankruptcy,'wealth':wealth,
        'unavailableModes':[] if multiplier_ok else ['MULT'],
        # PRIVATE: Render strips this before public API or public archive.
        # Apps Script writes AID-matched payout worksheets under manager access.
        'awardLedger':{'eventEpoch':event['epoch'],'registeredAids':list(aids),
                       'machineRows':admin_ledger}
    },count

def print_report(snapshot,count):
    print('\n【本機數據測試】')
    print('來源：已授權的本機 B2B 後台；本次僅為測試資料，非派獎結算。')
    for code in ('SET2','THOR'):
        print(code,'總投注額前 10 名：',[(r['rank'],r['nickname'],r['score']) for r in snapshot['rankings'][code]['BET']])
        print(code,'倍率：', '需提供本次登記 AID 才能查詢' if 'MULT' in snapshot['unavailableModes'] else '已從帳號查詢 xpay 取得')
    print('  神運榜：雙機台 %s 人，賽特 %s 人，雷神 %s 人（僅本次已登記玩家）。' % tuple(len(snapshot['luckboard'][k]) for k in ('ALL','SET2','THOR')))
    print('（上述輸出不包含玩家 AID、姓名或後台 session。）')

def publish(snapshot):
    token=require(TOKEN.read_text('utf-8').strip() if TOKEN.exists() else '',
            '缺少 .sync-token。請先在本機設定同步金鑰（切勿放到 Git）。')
    request=urllib.request.Request(PUSH_URL,
        data=json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode('utf8'),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(request,timeout=25) as response:
            obj=json.loads(response.read(5000).decode('utf8'))
    except urllib.error.HTTPError as e:
        raise B2BError('Render 接收失敗，HTTP %s（請檢查同步金鑰）。' % e.code) from None
    except urllib.error.URLError:
        raise B2BError('本機無法連接 Render 同步端點，請檢查網路。') from None
    if not obj.get('ok'):raise B2BError('Render 未確認寫入排行榜。')
    print('✓ Render 已接收經隱私過濾的測試榜單，時間：'+str(obj.get('lastUpdated')))

def guided_setup(api,cfg):
    print('\n【首次設定：僅選擇有權使用的廠商與指定遊戲】')
    vendors=api.discover()
    vendor_ids={str(v.get('id')) for v in vendors if isinstance(v,dict) and v.get('id') is not None}
    vendor=input('請輸入本次活動正確的 vendorId：').strip()
    if vendor not in vendor_ids:
        raise B2BError('vendorId 不在有權限的廠商清單內，請再次確認。')
    game_list=api.games(vendor)
    possible={str(g.get('name')) for g in game_list if isinstance(g,dict) and g.get('name') is not None}
    new_games={}
    for code,label in (('SET2','戰神賽特 II 神之庇護'),('THOR','雷神之錘')):
        chosen=input('請輸入 %s（%s）的 gameName：' % (code,label)).strip()
        if chosen not in possible:
            raise B2BError('%s 不是該廠商機台清單的 gameName；不能猜測機台。' % code)
        new_games[code]=chosen
    if new_games['SET2']==new_games['THOR']:
        raise B2BError('兩款指定機台不可以使用同一 gameName。')
    start=input('本次測試統計起點（台灣時間 YYYY/MM/DD HH:mm:ss）：').strip()
    new_cfg={'account':api.account,'vendorId':int(vendor),'games':new_games,
             'startTW':start,'officialMultiplierField':'','requireVerifiedRegistrations':True}
    config_check(new_cfg)
    CONFIG.write_text(json.dumps(new_cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('\n✓ 已儲存 config.local.json（不含密碼）。可執行 --inspect 檢查數據欄位。')
    return new_cfg


def inspect_one(api,cfg):
    vendor,games,start=config_check(cfg)
    stop=datetime.now(LOCAL_ZONE)
    aids=registered_aids(cfg)
    for code in ('SET2','THOR'):
        game=games[code]
        summary=unwrap_player_rows(api.call('gameSTMT/vendorGamePlayerSTMT',
            {'advertiserId':None,'vendorId':vendor,'gameName':game,
             'start':date_arg(start),'stop':date_arg(stop)}))
        print(code,'玩家數據筆數',len(summary),'玩家數據欄位',sorted(summary[0].keys()) if summary else [])
        options=api.call('tools/vendorGameList',{'vendorId':vendor})
        matches=[g for g in options if isinstance(g,dict) and str(g.get('name'))==str(game)]
        print(code,'帳號查詢機台對應數',len(matches))
        if aids and len(matches)==1:
            data=api.call('gameSTMT/searchAccountSTMT',{
                'page':1,'limit':10,'a_id':aids[0],
                'start':start.strftime('%Y-%m-%d %H:%M:%S'),
                'stop':stop.strftime('%Y-%m-%d %H:%M:%S'),
                'pay':0,'vendor_id':str(vendor),'game_id':str(matches[0]['id'])
            })
            if isinstance(data,dict):
                rows=data.get('data') if isinstance(data.get('data'),list) else []
                print(code,'已登記玩家注單總數',data.get('total'),'注單欄位',sorted(rows[0].keys()) if rows else [])
    print('僅顯示欄位名稱與筆數，沒有輸出 AID、姓名或單號。')

def next_sync_wait(interval_seconds, cycle_elapsed_seconds, min_gap=10):
    """Target interval between cycle STARTS while preventing busy retry loops.

    A cycle has several B2B requests (two games + registered AID wallet checks).
    If it runs longer than the target, do not overlap cycles or hammer the API.
    """
    return max(min_gap, interval_seconds-max(0,cycle_elapsed_seconds))


def main():
    parser=argparse.ArgumentParser(description='SD×贏麻了：使用本機白名單 IP 安全同步 B2B 測試排行榜')
    parser.add_argument('--setup',action='store_true',help='首次設定精靈：選擇兩機台及活動起點')
    parser.add_argument('--discover',action='store_true',help='列出 B2B 廠商和指定 vendor 的機台代碼')
    parser.add_argument('--vendor',type=int,help='搭配 --discover 查看此廠商機台')
    parser.add_argument('--inspect',action='store_true',help='只看後台欄位名稱及筆數，不傳送資料')
    parser.add_argument('--inspect-balance',action='store_true',help='只列出本機會員金幣欄位的名稱')
    parser.add_argument('--dry-run',action='store_true',help='計算榜單但不傳至 Render')
    parser.add_argument('--loop',action='store_true',help='每 90 秒開始一輪同步（B2B 查詢較久時會順延），需保持視窗開啟')
    parser.add_argument('--interval',type=int,default=90,help='兩次同步開始時間的目標間隔秒數，預設 90 秒，至少 60 秒')
    parser.add_argument('--account',help='可覆蓋 config.local.json 內的帳號')
    args=parser.parse_args()
    cfg=read_config()
    account=args.account or cfg.get('account') or os.environ.get('B2B_ACCOUNT')
    if not account:account=input('B2B 帳號：').strip()
    print('✓ 已載入本機設定，請在下方輸入 B2B 密碼；輸入時不會顯示任何字元。',flush=True)
    password=os.environ.get('B2B_PASSWORD') or getpass.getpass('B2B 密碼（畫面不顯示，按 Enter 送出）：')
    print('✓ 已收到密碼，正在驗證 B2B 登入（單次請求最多 25 秒）...',flush=True)
    set_status('logging_in')
    api=Backend(account,password)
    set_status('authenticated')
    print('✓ 後台登入驗證通過；使用本機網路，不繞過白名單。')
    if args.setup:
        guided_setup(api,cfg)
        return 0
    if args.discover:
        api.discover()
        vendor=args.vendor or cfg.get('vendorId')
        if vendor:api.games(vendor)
        return 0
    if args.inspect:
        inspect_one(api,cfg)
        return 0
    if args.inspect_balance:
        inspect_balance_fields(api,cfg)
        return 0
    verifier_stop=threading.Event()
    verifier_threads=[]
    if args.loop:
        pending_jobs=queue.Queue(maxsize=64)
        queued_ids=set()
        queued_lock=threading.Lock()
        verifier_threads=[
            threading.Thread(target=verifier_poller,
                args=(verifier_stop,pending_jobs,queued_ids,queued_lock),
                name='sdx-aid-heartbeat',daemon=True),
            threading.Thread(target=verifier_job_worker,
                args=(api,verifier_stop,pending_jobs,queued_ids,queued_lock),
                name='sdx-aid-b2b-check',daemon=True),
        ]
        for thread in verifier_threads:thread.start()
        print('✓ AID 心跳與 B2B 驗證已獨立執行，不受排行榜耗時影響。',flush=True)
    cycle_number=0
    while True:
        cycle_number+=1
        cycle_started=time.monotonic()
        if args.loop:
            for index,thread in enumerate(verifier_threads):
                if not thread.is_alive():
                    set_verifier_status('worker_restarting',thread.name)
                    replacement=threading.Thread(
                        target=verifier_poller if index==0 else verifier_job_worker,
                        args=(verifier_stop,pending_jobs,queued_ids,queued_lock)
                             if index==0 else (api,verifier_stop,pending_jobs,queued_ids,queued_lock),
                        name=thread.name,daemon=True)
                    replacement.start()
                    verifier_threads[index]=replacement
                    print('  驗證背景執行緒已自動重新啟動。',flush=True)
        print('\n=== 第 %d 輪同步開始（每輪目標 90 秒開始）===' % cycle_number,flush=True)
        try:
            set_status('reading_b2b')
            snapshot,count=create_snapshot(api,cfg)
            set_status('data_ready')
            print_report(snapshot,count)
            if not args.dry_run:
                set_status('publishing')
                print('【資料上傳】正在同步到 Render 與 Google Sheets（網路請求最多 25 秒）...',flush=True)
                publish(snapshot)
                set_status('published')
            else:
                set_status('dry_run_completed')
        except B2BError as exc:
            set_status('failed',exc)
            print('✗ 本輪同步失敗：%s；下一輪會自動重試，不會清掉舊榜。' % str(exc),file=sys.stderr,flush=True)
            if not args.loop:return 2
        except (OSError,ValueError,TypeError,KeyError,AttributeError) as exc:
            # Keep the console alive for intermittent responses but never log
            # HTTP request bodies, cookies, credentials or private AIDs.
            message='執行異常（%s）；請保留這個錯誤類型供檢查。' % type(exc).__name__
            set_status('failed',message)
            print('✗ '+message+' 下一輪將重試，不影響已發布榜單。',file=sys.stderr,flush=True)
            if not args.loop:return 2
        if not args.loop:break
        elapsed=time.monotonic()-cycle_started
        seconds=next_sync_wait(max(60,args.interval),elapsed)
        print('本輪耗時 %.1f 秒；下次約 %.1f 秒後開始（目標每 %d 秒，B2B 查詢較久時會順延）。按 Ctrl+C 結束。' %
              (elapsed,seconds,max(60,args.interval)))
        try:time.sleep(seconds)
        except KeyboardInterrupt:break
    verifier_stop.set()
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except B2BError as exc:
        set_status('failed',exc)
        print('✗',str(exc),file=sys.stderr);sys.exit(2)
    except KeyboardInterrupt:
        set_status('stopped')
        print('已停止',flush=True);sys.exit(130)
    except Exception as exc:
        # Startup failures before the first loop used to close the CMD window
        # without a meaningful status. Only expose exception class, no secrets.
        message='程式啟動異常（%s）' % type(exc).__name__
        set_status('crashed',message)
        print('✗ '+message+'；請查看啟動視窗與 sync-status.json。',file=sys.stderr,flush=True)
        sys.exit(1)
