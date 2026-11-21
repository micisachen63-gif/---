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
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from collections import defaultdict

B2B_BASE = 'https://admin-b2b.winmalo.com:9032/api/'
PUSH_URL = 'https://sdx-winmalo-b2b-ranking-api-2026.onrender.com/api/ingest'
PRIVATE_API_BASE = 'https://sdx-winmalo-b2b-ranking-api-2026.onrender.com'
LOCAL_ZONE = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.local.json'
TOKEN = ROOT / '.sync-token'
STATUS_FILE = ROOT / 'sync-status.json'

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
        except json.JSONDecodeError:
            raise B2BError('B2B 回傳 HTML 或非 JSON；可能需要網頁登入、授權或不同 API。') from None

    def login(self):
        result = self.request('login', {'account':self.account,'password':self.password})
        if not isinstance(result,dict) or result.get('status') != 'success':
            raise B2BError('B2B 登入未成功，請檢查帳密、白名單或額外驗證。')
        if not list(self.cookies):
            raise B2BError('登入未得到有效 session cookie；請檢查 B2B API 登入流程。')

    def call(self, endpoint, args):
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


def normalize_leaders(total_by_user, names):
    values=[(user,score) for user,score in total_by_user.items() if score>0]
    values.sort(key=lambda x:(-x[1],x[0]))
    return [{'rank':i+1,'nickname':names.get(user,'匿名玩家'),'score':round(score,4)}
            for i,(user,score) in enumerate(values[:PUBLIC_LIMIT])]


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

def verified_registration_aids():
    """Only AIDs actually registered in the event Google Sheet."""
    obj=receiver_api('/api/verifier/aids')
    if obj.get('ok') is not True or obj.get('eventCode')!='DUAL2026' or not isinstance(obj.get('aids'),list):
        raise B2BError('Google 試算表登記名單尚未可用，不發布未確認資格的榜單。')
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
    return values

def verifier_worker(account,password,stop):
    """Lightweight 5s poll in a separate thread while normal leaderboard sync runs."""
    api=None
    while not stop.is_set():
        try:
            if api is None:
                api=Backend(account,password)
                print('✓ 本機會員 AID 驗證器已登入 B2B；等待前端登記請求。')
            received=receiver_api('/api/verifier/jobs')
            if not received.get('ok') or not isinstance(received.get('jobs'),list):
                raise B2BError('活動驗證工作清單格式無效。')
            for item in received['jobs']:
                if not isinstance(item,dict) or not isinstance(item.get('requestId'),str):
                    continue
                request_id=item['requestId']
                aid=str(item.get('aid') or '')
                try:
                    exists=verify_exists_on_b2b(api,aid)
                    response=receiver_api('/api/verifier/result',{'requestId':request_id,'exists':exists})
                    print('  AID 檢查結果：%s；登記狀態：%s' % ('存在' if exists else '不存在',response.get('status','未完成')))
                except B2BError:
                    # Never mistake network/API failure for nonexistent AID.
                    try: receiver_api('/api/verifier/result',{'requestId':request_id,'error':True})
                    except B2BError: pass
                    print('  AID 驗證失敗；未寫入任何登記資料（帳號資訊不輸出）。')
            stop.wait(5)
        except B2BError as exc:
            # No user AID, cookie or secret in logs.
            print('  本機驗證器暫不可用：'+str(exc))
            api=None
            stop.wait(12)

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

def account_multiplier_rankings(api,vendor,game_id,game_name,start,stop,aids,names):
    """遊戲報表 > 帳號查詢; query registered AID and use official field xpay."""
    highest={}
    page_limit=100
    for idx,aid in enumerate(aids):
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
                if str(doc) in seen:continue
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
        if best>0:
            highest[aid]=best
        if (idx+1)%20==0:
            print('  已完成倍率帳號核對 %s/%s 人。' % (idx+1,len(aids)))
    return normalize_leaders(highest,names)

def sync_one_game(api,vendor,game,start,stop,aids,include_multiplier=True,restrict_registered=False):
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
    if not aids or not include_multiplier:
        return bet,[],False,{'players':len(summary),'registrants':len(aids),'account_queries':0},machine_rtp,luck_players
    game_id=find_account_game_id(api,vendor,game)
    mult=account_multiplier_rankings(api,vendor,game_id,game,start,stop,aids,names)
    return bet,mult,True,{'players':len(summary),'registrants':len(aids),'account_queries':len(aids)},machine_rtp,luck_players

def create_snapshot(api,cfg):
    vendor,games,start=config_check(cfg)
    stop=datetime.now(LOCAL_ZONE)
    if (stop-start).total_seconds()>45*86400:
        raise B2BError('單次同步最多 45 天；請確認本次測試統計起點。')
    aids=verified_registration_aids() if cfg.get('requireVerifiedRegistrations',True) else registered_aids(cfg)
    ranks={}
    count={}
    rtp={}
    luck_players={}
    multiplier_ok=True
    for code in ('SET2','THOR'):
        print('讀取 %s（後台 gameName=%s）…' % (code,games[code]))
        bet,mult,valid,stat,rtp_value,per_player=sync_one_game(api,vendor,games[code],start,stop,aids,restrict_registered=cfg.get('requireVerifiedRegistrations',True))
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
    return {
        'version':1,'source':'local-whitelisted-b2b',
        'lastUpdated':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'rankings':ranks,'rtp':rtp,'luckboard':luckboard,'unavailableModes':[] if multiplier_ok else ['MULT']
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

def main():
    parser=argparse.ArgumentParser(description='SD×贏麻了：使用本機白名單 IP 安全同步 B2B 測試排行榜')
    parser.add_argument('--setup',action='store_true',help='首次設定精靈：選擇兩機台及活動起點')
    parser.add_argument('--discover',action='store_true',help='列出 B2B 廠商和指定 vendor 的機台代碼')
    parser.add_argument('--vendor',type=int,help='搭配 --discover 查看此廠商機台')
    parser.add_argument('--inspect',action='store_true',help='只看後台欄位名稱及筆數，不傳送資料')
    parser.add_argument('--dry-run',action='store_true',help='計算榜單但不傳至 Render')
    parser.add_argument('--loop',action='store_true',help='每 2 分鐘同步一次；需保持視窗開啟')
    parser.add_argument('--interval',type=int,default=120,help='循環秒數，至少 60 秒')
    parser.add_argument('--account',help='可覆蓋 config.local.json 內的帳號')
    args=parser.parse_args()
    cfg=read_config()
    account=args.account or cfg.get('account') or os.environ.get('B2B_ACCOUNT')
    if not account:account=input('B2B 帳號：').strip()
    password=os.environ.get('B2B_PASSWORD') or getpass.getpass('B2B 密碼（畫面不顯示）：')
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
    verifier_stop=threading.Event()
    verifier_thread=None
    if args.loop:
        verifier_thread=threading.Thread(target=verifier_worker,
            args=(account,password,verifier_stop),name='sdx-aid-verifier',daemon=True)
        verifier_thread.start()
    while True:
        try:
            set_status('reading_b2b')
            snapshot,count=create_snapshot(api,cfg)
            set_status('data_ready')
            print_report(snapshot,count)
            if not args.dry_run:
                set_status('publishing')
                publish(snapshot)
                set_status('published')
            else:
                set_status('dry_run_completed')
        except B2BError as exc:
            set_status('failed',exc)
            print('✗ 同步停止：',str(exc),file=sys.stderr)
            if not args.loop:return 2
        if not args.loop:break
        seconds=max(60,args.interval)
        print('下次同步：約 %s 秒後；按 Ctrl+C 結束。' % seconds)
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
        print('已停止');sys.exit(130)
