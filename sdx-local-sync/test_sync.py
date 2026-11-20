import unittest
from datetime import datetime,timedelta,timezone
from collections import defaultdict
import sync_b2b as t

class B2BLocalTests(unittest.TestCase):
    def test_official_fields_only(self):
        self.assertEqual(t.official_bet_field({'bet':200}),None)
        self.assertEqual(t.official_bet_field({'bet':200,'validBetAmount':150}),'validBetAmount')
    def test_rank_score_and_no_aid(self):
        rows=t.normalize_leaders({'1000000':55,'2000000':100}, {'1000000':'甲','2000000':'乙'})
        self.assertEqual(rows[0],{'rank':1,'nickname':'乙','score':100})
        self.assertNotIn('1000000',str(rows))
    def test_parse_timestamp(self):
        dt=t.parse_time('2026/11/20 16:30:00')
        self.assertEqual(dt.utcoffset(),timedelta(hours=8))
    def test_nan_rejected(self):
        self.assertIsNone(t.positive('NaN'))
        self.assertIsNone(t.positive(-1))
    def test_unknown_rows_fail(self):
        with self.assertRaises(t.B2BError):
            t.unwrap_player_rows({'unexpected':'data'})

class ReportRouteTests(unittest.TestCase):
    def test_player_data_uses_total_bet_not_effective_bet(self):
        rows=[
            {'aId':'20000001','nickname':'甲','bet':52000,'validBet':100,'betCount':12},
            {'aId':'20000002','nickname':'乙','bet':372000,'validBet':5,'betCount':20},
        ]
        rank, names, totals=t.summary_bet_rankings(rows,[])
        self.assertEqual([r['nickname'] for r in rank],['乙','甲'])
        self.assertEqual(rank[0]['score'],372000)
        self.assertEqual(totals['20000001'],52000)
        self.assertNotIn('aId',str(rank))

    def test_registered_aids_filter_player_ranking(self):
        rows=[
            {'aId':'20000001','nickname':'甲','bet':52000},
            {'aId':'20000002','nickname':'乙','bet':372000},
        ]
        rank, names, totals=t.summary_bet_rankings(rows,['20000001'])
        self.assertEqual(len(rank),1)
        self.assertEqual(rank[0]['nickname'],'甲')

    def test_summary_duplicate_or_missing_total_is_rejected(self):
        with self.assertRaises(t.B2BError):
            t.summary_bet_rankings([{'aId':'20000001','nickname':'甲','validBet':12}],[])
        with self.assertRaises(t.B2BError):
            t.summary_bet_rankings([{'aId':'20000001','bet':20},{'aId':'20000001','bet':30}],[])

    def test_account_multiplier_from_registered_aid_only(self):
        class API:
            called=[]
            def call(self,endpoint,body):
                self.called.append((endpoint,body))
                self_ep=endpoint
                if self_ep=='tools/vendorGameList':
                    return [{'id':1805,'name':'slot1805','description':'雷神之錘'}]
                self_aid=body['a_id']
                time_value='2026-11-20 15:00:00'
                if self_aid=='20000001':
                    return {'total':2,'per_page':100,'data':[
                        {'a_id':'20000001','docNo':'0001','time':time_value,'xpay':'230.5'},
                        {'a_id':'20000001','docNo':'0002','time':time_value,'xpay':'1107.3'}
                    ]}
                return {'total':1,'per_page':100,'data':[
                    {'a_id':'20000002','docNo':'0003','time':time_value,'xpay':'777.85'}
                ]}
        api=API()
        game_id=t.find_account_game_id(api,99,'slot1805')
        self.assertEqual(game_id,'1805')
        start=datetime(2026,11,20,0,0,0,tzinfo=t.LOCAL_ZONE)
        stop=datetime(2026,11,20,23,59,59,tzinfo=t.LOCAL_ZONE)
        result=t.account_multiplier_rankings(api,99,game_id,'slot1805',start,stop,
            ['20000001','20000002'],{'20000001':'甲','20000002':'乙'})
        self.assertEqual(result,[{'rank':1,'nickname':'甲','score':1107.3},
                                 {'rank':2,'nickname':'乙','score':777.85}])
        calls=[b for endpoint,b in api.called if endpoint=='gameSTMT/searchAccountSTMT']
        self.assertEqual(len(calls),2)
        self.assertTrue(all(c['vendor_id']=='99' and c['game_id']=='1805' for c in calls))
        self.assertNotIn('20000001',str(result))

    def test_account_search_rejects_mixed_aid_or_incomplete_pagination(self):
        class API:
            def call(self,endpoint,body):
                return {'total':2,'data':[{'a_id':'another-user','docNo':'fake',
                    'time':'2026-11-20 15:00:00','xpay':999}]}
        start=datetime(2026,11,20,0,0,0,tzinfo=t.LOCAL_ZONE)
        stop=datetime(2026,11,20,23,59,59,tzinfo=t.LOCAL_ZONE)
        with self.assertRaises(t.B2BError):
            t.account_multiplier_rankings(API(),99,'1805','slot1805',
                start,stop,['20000001'],{'20000001':'甲'})

    def test_only_registered_aids_are_loaded_from_csv(self):
        import tempfile
        old_root=t.ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                t.ROOT=t.Path(tmp)
                p=t.Path(tmp)/'registered_aids.csv'
                p.write_text('AID,nickname\\n20000001,甲\\n20000001,甲\\n20000002,乙\\n',encoding='utf8')
                self.assertEqual(t.registered_aids({}),['20000001','20000002'])
        finally:
            t.ROOT=old_root

if __name__=='__main__': unittest.main()
