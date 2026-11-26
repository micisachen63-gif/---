import unittest
from datetime import datetime,timedelta
import sync_b2b as t

class FakeBackend:
    def __init__(self):
        self.calls=[]
        self.rows=[]
        self.fail=False
    def call(self,endpoint,body):
        assert endpoint=='gameSTMT/searchAccountSTMT'
        self.calls.append(body)
        if self.fail:raise t.B2BError('test outage')
        start=t.parse_time(body['start'])
        stop=t.parse_time(body['stop'])
        rows=[r for r in self.rows if r['a_id']==body['a_id'] and start<=t.parse_time(r['time'])<=stop]
        return {'total':len(rows),'data':rows}

class CacheTests(unittest.TestCase):
    def setUp(self):
        self.api=FakeBackend()
        self.start=datetime(2026,11,26,10,tzinfo=t.LOCAL_ZONE)
        self.cache={}
        self.aid='1000000081'
    def add(self,minute,value,doc):
        self.api.rows.append({'a_id':self.aid,'docNo':doc,'time':t.date_arg(self.start+timedelta(minutes=minute)),'xpay':value})
    def query(self,minute,force=False):
        return t.account_multiplier_rankings(self.api,2,1804,'slot1804',self.start,self.start+timedelta(minutes=minute),[self.aid],{self.aid:'test'},return_raw=True,cache=self.cache,force_full=force)[1]
    def test_incremental_keeps_history_and_finds_late_rows(self):
        self.add(1,500,'a')
        self.assertEqual(self.query(10)[self.aid],500)
        self.add(8,700,'b')
        self.assertEqual(self.query(12)[self.aid],700)
        self.assertEqual(self.api.calls[-1]['start'],'2026-11-26 10:05:00')
        self.assertEqual(self.query(14)[self.aid],700)
    def test_periodic_and_forced_full_reconcile_corrections(self):
        self.add(1,500,'a')
        self.query(10)
        self.api.rows[0]['xpay']=100
        self.assertEqual(self.query(12)[self.aid],500)
        self.assertEqual(self.query(30)[self.aid],100)
        self.api.rows[0]['xpay']=50
        self.assertEqual(self.query(31,True)[self.aid],50)
    def test_failure_does_not_advance_cache(self):
        self.add(1,500,'a')
        self.query(10)
        previous=dict(self.cache)
        self.api.fail=True
        with self.assertRaises(t.B2BError):self.query(12)
        self.assertEqual(self.cache,previous)
    def test_new_player_starts_with_full_history(self):
        self.query(10)
        self.cache.clear()
        self.add(1,500,'a')
        self.assertEqual(self.query(12)[self.aid],500)

if __name__=='__main__':unittest.main()
