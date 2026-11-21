import unittest
from datetime import datetime
import sync_b2b as t

class FakeBackend:
    def call(self,endpoint,params):
        if endpoint=='gameSTMT/vendorGamePlayerSTMT':
            return {'data':[
                {'a_id':'1000000081','nickname':'第一人','bet':680000,'pay':620000,'betCount':1100},
                {'a_id':'1000000183','nickname':'第二人','bet':280000,'pay':300000,'betCount':500}
            ]}
        if endpoint=='tools/vendorGameList':
            return [{'name':'slot1804','id':1804}]
        if endpoint=='gameSTMT/searchAccountSTMT':
            return {'total':1,'data':[{
                'a_id':params['a_id'],'docNo':'doc-'+params['a_id'],
                'time':'2026/11/20 12:10:00',
                'xpay':1200 if params['a_id']=='1000000081' else 500
            }]}
        raise AssertionError(endpoint)

class AwardLedgerTests(unittest.TestCase):
    def test_public_and_private_derive_from_same_api_rows(self):
        api=FakeBackend()
        start=datetime(2026,11,20,0,0,tzinfo=t.LOCAL_ZONE)
        stop=datetime(2026,11,20,23,0,tzinfo=t.LOCAL_ZONE)
        bet,mult,ready,stats,rtp,players,private=t.sync_one_game(
            api,2,'slot1804',start,stop,['1000000081','1000000183'],
            restrict_registered=True,include_admin=True)
        self.assertTrue(ready)
        self.assertEqual(bet[0],{'rank':1,'nickname':'第一人','score':680000})
        self.assertEqual(mult[0],{'rank':1,'nickname':'第一人','score':1200})
        self.assertEqual(private['BET'][0],{'rank':1,'nickname':'第一人','score':680000,'aid':'1000000081'})
        self.assertEqual(private['MULT'][0]['aid'],'1000000081')
        self.assertEqual(private['ACH'][0]['bet'],680000)
        self.assertEqual(private['ACH'][1]['bet'],280000)
        self.assertNotIn('1000000081',str(bet)+str(mult))
        self.assertEqual(stats['account_queries'],2)
        self.assertEqual(len(players),2)
    def test_legacy_public_rank_function_never_leaks_aid(self):
        public=t.normalize_leaders({'1000000081':10000},{'1000000081':'同名玩家'})
        private=t.normalize_leaders({'1000000081':10000},{'1000000081':'同名玩家'},include_aid=True)
        self.assertNotIn('aid',public[0])
        self.assertEqual(private[0]['aid'],'1000000081')

if __name__=='__main__':
    unittest.main()
