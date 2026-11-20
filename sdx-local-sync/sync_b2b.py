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
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from collections import defaultdict

B2B_BASE = 'https://admin-b2b.winmalo.com:9032/api/'
PUSH_URL = 'https://sdx-winmalo-b2b-ranking-api-2026.onrender.com/api/ingest'
LOCAL_ZONE = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.local.json'
TOKEN = ROOT / '.sync-token'
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

def fetch_slips(api,vendor,game,start,stop,names,official_multiplier_field=''):
    total_rows=0
    total_expected=None
    next_page=1
    seen=set()
    totals=defaultdict(float)
    max_multipliers=defaultdict(float)
    found_multiplier=bool(official_multiplier_field)
    while True:
        if next_page>MAX_PAGE:
            raise B2BError('超過 500 頁注單，停止同步以免將部分數據誤當完整榜單。')
        request={'page':next_page,'limit':100,'vendorId':vendor,'gameName':game,
                 'start':date_day(start),'stop':date_day(stop+timedelta(days=1))}
        data=api.call('gameSTMT/vendorGameSTMTLog',request)
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):
            raise B2BError('水單 API 回應格式不符；必須核對官方欄位。')
        rows=data['data']
        expected=positive(data.get('total'))
        if expected is None: raise B2BError('水單 API 未提供總筆數，無法驗證分頁完整性。')
        if total_expected is None:total_expected=int(expected)
        elif total_expected!=int(expected):raise B2BError('同步過程中注單總筆數變化，請重跑以確保一致。')
        total_rows+=len(rows)
        if total_rows>150000:raise B2BError('水單數超過 15 萬筆上限，請縮短查詢日期後重試。')
        for row in rows:
            if not isinstance(row,dict):raise B2BError('注單資料格式不符。')
            slip_id=next((str(row.get(k)) for k in ('betId','bet_id','docNo','gameNo') if row.get(k)),None)
            if not slip_id:raise B2BError('注單缺少唯一 ID，無法安全去重。')
            if slip_id in seen:continue
            seen.add(slip_id)
            stamp=parse_time(row.get('betTime') or row.get('createTime') or row.get('createdAt'))
            if stamp<start or stamp>stop:continue
            user=row_key(row)
            if not user:raise B2BError('注單缺少玩家 ID，無法彙總每人押碼。')
            field=official_bet_field(row)
            if not field:raise B2BError('水單缺少 validBetAmount／validBet 欄位，請使用 --inspect 核對。')
            value=positive(row[field])
            if value is None:raise B2BError('注單的有效押碼不是合法數值。')
            totals[user]+=value
            if user not in names:names[user]=nickname(row)
            if official_multiplier_field:
                if official_multiplier_field not in row:
                    found_multiplier=False
                else:
                    n=positive(row[official_multiplier_field])
                    if n is None:raise B2BError('倍率欄位存在非數值，停止同步。')
                    if n>max_multipliers[user]:max_multipliers[user]=n
        if total_rows>=total_expected:break
        if not rows:raise B2BError('水單分頁尚未讀完卻提前空白，停止同步。')
        next_page+=1
    bet=normalize_leaders(totals,names)
    mult=normalize_leaders(max_multipliers,names) if found_multiplier else []
    return bet,mult,total_rows,found_multiplier

def sync_one_game(api,vendor,game,start,stop,official_field):
    args={'advertiserId':None,'vendorId':vendor,'gameName':game,'start':date_arg(start),'stop':date_arg(stop)}
    summary=unwrap_player_rows(api.call('gameSTMT/vendorGamePlayerSTMT',args))
    names={}
    direct_totals={}
    for row in summary:
        if not isinstance(row,dict):raise B2BError('玩家報表列格式不符。')
        user=row_key(row)
        if user: names[user]=nickname(row)
        field=official_bet_field(row)
        if field and user:
            value=positive(row[field])
            if value is None:raise B2BError('玩家有效押碼非數值，請先檢查。')
            direct_totals[user]=value
    if summary and len(direct_totals)==len(summary):
        print('  使用 B2B 玩家報表的明確有效押碼欄位（不使用總投注額 bet）。')
        bet=normalize_leaders(direct_totals,names)
        # Per-hand multipliers require a different, official per-slip field; never guess from RTP.
        if official_field:
            _,mult,total,valid=fetch_slips(api,vendor,game,start,stop,names,official_field)
            return bet,mult,valid,{'players':len(summary),'slips':total}
        return bet,[],False,{'players':len(summary),'slips':None}
    print('  玩家報表沒有完整有效押碼欄位，改使用逐筆水單 validBetAmount 彙總。')
    bet,mult,total,valid=fetch_slips(api,vendor,game,start,stop,names,official_field)
    return bet,mult,valid,{'players':len(summary),'slips':total}

def create_snapshot(api,cfg):
    vendor,games,start=config_check(cfg)
    stop=datetime.now(LOCAL_ZONE)
    if (stop-start).total_seconds()>45*86400:
        raise B2BError('單次同步最多 45 天；請確認測試的活動起始日期。')
    ranks={}
    count={}
    multiplier_ok=True
    for code in ('SET2','THOR'):
        print('讀取 %s（後台 gameName=%s）…' % (code,games[code]))
        bet,mult,valid,stat=sync_one_game(api,vendor,games[code],start,stop,str(cfg.get('officialMultiplierField') or '').strip())
        ranks[code]={'BET':bet,'MULT':mult}
        count[code]=stat
        multiplier_ok=multiplier_ok and valid
        print('  押碼榜 %s 人，倍率榜 %s 人；已檢查 %s' % (len(bet),len(mult),stat))
    return {
        'version':1,'source':'local-whitelisted-b2b',
        'lastUpdated':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'rankings':ranks,'unavailableModes':[] if multiplier_ok else ['MULT']
    },count

def print_report(snapshot,count):
    print('\n【本機數據測試】')
    print('來源：已授權的本機 B2B 後台；本次僅為測試資料，非派獎結算。')
    for code in ('SET2','THOR'):
        print(code,'有效押碼前 10 名：',[(r['rank'],r['nickname'],r['score']) for r in snapshot['rankings'][code]['BET']])
        print(code,'倍率：', '待核對官方逐局倍率欄位' if 'MULT' in snapshot['unavailableModes'] else '已取得')
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
             'startTW':start,'officialMultiplierField':''}
    config_check(new_cfg)
    CONFIG.write_text(json.dumps(new_cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('\n✓ 已儲存 config.local.json（不含密碼）。可執行 --inspect 檢查數據欄位。')
    return new_cfg

def inspect_one(api,cfg):
    vendor,games,start=config_check(cfg)
    stop=datetime.now(LOCAL_ZONE)
    for code in ('SET2','THOR'):
        game=games[code]
        sm=unwrap_player_rows(api.call('gameSTMT/vendorGamePlayerSTMT',
            {'advertiserId':None,'vendorId':vendor,'gameName':game,'start':date_arg(start),'stop':date_arg(stop)}))
        print(code,'玩家彙總筆數',len(sm),'彙總欄位',sorted(sm[0].keys()) if sm else [])
        slips=api.call('gameSTMT/vendorGameSTMTLog',
            {'page':1,'limit':10,'vendorId':vendor,'gameName':game,
             'start':date_day(start),'stop':date_day(stop+timedelta(days=1))})
        if isinstance(slips,dict):
            arr=slips.get('data') if isinstance(slips.get('data'),list) else []
            print(code,'注單總數',slips.get('total'),'注單欄位',sorted(arr[0].keys()) if arr else [])
    print('只輸出欄位名稱與筆數，不印出玩家 AID／原始注單。')

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
    api=Backend(account,password)
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
    while True:
        try:
            snapshot,count=create_snapshot(api,cfg)
            print_report(snapshot,count)
            if not args.dry_run:publish(snapshot)
        except B2BError as exc:
            print('✗ 同步停止：',str(exc),file=sys.stderr)
            if not args.loop:return 2
        if not args.loop:break
        seconds=max(60,args.interval)
        print('下次同步：約 %s 秒後；按 Ctrl+C 結束。' % seconds)
        try:time.sleep(seconds)
        except KeyboardInterrupt:break
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except B2BError as exc:
        print('✗',str(exc),file=sys.stderr);sys.exit(2)
    except KeyboardInterrupt:
        print('已停止');sys.exit(130)
