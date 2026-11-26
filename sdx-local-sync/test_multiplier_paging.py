import unittest
from datetime import datetime
import sync_b2b as t

class FakeBackend:
    def __init__(self,mode='normal'):
        self.mode=mode
        self.calls=[]
    def call(self,endpoint,args):
        assert endpoint=='gameSTMT/searchAccountSTMT'
        aid=args['a_id'];p=args['page'];n=args['limit']
        self.calls.append((aid,p,n))
        rows=[{'a_id':aid,'docNo':str(i),'time':'2026-11-26 11:00:00','xpay':i} for i in range(451)]
        if self.mode=='error' and n==200:raise t.B2BError('unsupported')
        if self.mode=='all_error':raise t.B2BError('outage')
        if self.mode=='cap' and n==200:n=100
        if self.mode=='duplicate' and n==200 and p==2:p=1
        result=rows[(p-1)*n:p*n]
        if self.mode=='wrong_aid' and result:result[0]['a_id']='wrong'
        if self.mode=='changing_total' and n==200 and p==2:return {'total':452,'data':result}
        return {'total':451,'data':result}

class PagingTests(unittest.TestCase):
    def query(self,api):
        start=datetime(2026,11,26,10,tzinfo=t.LOCAL_ZONE)
        stop=datetime(2026,11,26,12,tzinfo=t.LOCAL_ZONE)
        return t.account_multiplier_rankings(api,2,1804,'slot1804',start,stop,['111111','222222'],{},return_raw=True)[1]
    def test_full_scan(self):
        api=FakeBackend()
        self.assertEqual(self.query(api),{'111111':450,'222222':450})
        self.assertEqual(len(api.calls),6)
    def test_fallback(self):
        for mode in ['error','cap','duplicate','changing_total']:
            with self.subTest(mode=mode):
                api=FakeBackend(mode)
                self.assertEqual(self.query(api),{'111111':450,'222222':450})
                self.assertTrue(all(n==100 for aid,p,n in api.calls if aid=='222222'))
    def test_errors_still_fail(self):
        for mode in ['all_error','wrong_aid']:
            with self.subTest(mode=mode),self.assertRaises(t.B2BError):self.query(FakeBackend(mode))
    def test_no_cache(self):
        api=FakeBackend()
        self.query(api);self.query(api)
        self.assertEqual(len(api.calls),12)
    def test_zero(self):
        class Empty:
            def call(self,*args):return {'total':0,'data':[]}
        self.assertEqual(self.query(Empty()),{})

if __name__=='__main__':unittest.main()
