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
                p.write_text('AID,nickname\n20000001,甲\n20000001,甲\n20000002,乙\n',encoding='utf8')
                self.assertEqual(t.registered_aids({}),['20000001','20000002'])
        finally:
            t.ROOT=old_root


class MemberVerificationTests(unittest.TestCase):
    def test_exact_aid_in_member_management(self):
        class FakeAPI:
            def call(self, endpoint, data):
                self.endpoint=endpoint
                self.data=data
                return {'total':2,'data':[
                    {'a_id':1000000081,'nickname':'不應公開', 'phone':'隱藏'},
                    {'a_id':1000000183,'nickname':'其他'}]}
        fake=FakeAPI()
        self.assertTrue(t.verify_exists_on_b2b(fake,'1000000081'))
        self.assertEqual(fake.endpoint,'player/list')
        self.assertEqual(fake.data['searchBy'],'0')
        self.assertEqual(fake.data['searchContent'],'1000000081')
        self.assertFalse(t.verify_exists_on_b2b(fake,'1000000909'))

    def test_partial_matches_do_not_count(self):
        class FakeAPI:
            def call(self,endpoint,data):
                return {'total':1,'data':[{'a_id':123456789,'nickname':'模糊匹配'}]}
        self.assertFalse(t.verify_exists_on_b2b(FakeAPI(),'23456789'))

    def test_unverified_backend_schema_fails_closed(self):
        class BadAPI:
            def call(self,endpoint,data):
                return {'unexpected':'not a member'}
        with self.assertRaises(t.B2BError):
            t.verify_exists_on_b2b(BadAPI(),'1000000081')

    def test_sheet_ids_only_with_server_authority(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            old=t.ROOT
            try:
                t.ROOT=t.Path(temp)
                with patch.object(t,'receiver_api',return_value={
                    'ok':True,'aids':['1000000081','1000000183','1000000081'],
                    'eventCode':'DUAL2026','event':{'phase':'CCB','epoch':1,'startTW':'','registeredCount':2}}):
                    found=t.verified_registration_aids()
                    self.assertEqual(found,['1000000081','1000000183'])
                    csv=(t.ROOT/'registered_aids.csv').read_text('utf8')
                    self.assertEqual(csv,'AID\n1000000081\n1000000183\n')
            finally:t.ROOT=old

    def test_failed_sheet_aid_refresh_must_not_publish_unregistered(self):
        from unittest.mock import patch
        with patch.object(t,'receiver_api',side_effect=t.B2BError('Sheets unavailable')):
            with self.assertRaises(t.B2BError):
                t.verified_registration_aids()



class EventGenerationTests(unittest.TestCase):
    def test_epoch_and_phase_returned_with_same_registered_aid_list(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            old=t.ROOT
            try:
                t.ROOT=t.Path(folder)
                response={'ok':True,'aids':['1000000081'],
                    'eventCode':'DUAL2026','event':{'phase':'OFFICIAL','epoch':8,
                    'startTW':'2026/12/01 10:00:00','endTW':'2026/12/03 18:00:00','registeredCount':1}}
                with patch.object(t,'receiver_api',return_value=response):
                    ids,event=t.verified_registration_aids(with_event=True)
                    self.assertEqual(ids,['1000000081'])
                    self.assertEqual(event['epoch'],8)
                    self.assertEqual(event['startTW'],'2026/12/01 10:00:00')
            finally:t.ROOT=old
    def test_missing_event_generation_rejected(self):
        from unittest.mock import patch
        with patch.object(t,'receiver_api',return_value={
            'ok':True,'aids':['1000000081'],'eventCode':'DUAL2026'}):
            with self.assertRaises(t.B2BError):
                t.verified_registration_aids(with_event=True)

class MachineRtpTests(unittest.TestCase):
    def test_weighted_game_rtp_matches_b2b_pay_over_bet(self):
        # Screenshot sample: 52,100 bet / 46,105 pay => 88.49%.
        self.assertEqual(t.machine_rtp_from_player_data([{'bet':52100,'pay':46105}]),88.49)
        # Weighted totals (not the mean of player RTP percentages).
        rows=[{'bet':100,'pay':50},{'bet':900,'pay':990}]
        self.assertEqual(t.machine_rtp_from_player_data(rows),104.0)
        self.assertNotEqual(t.machine_rtp_from_player_data(rows),80.0)
    def test_rtp_can_exceed_100_for_real_winning_machine(self):
        self.assertEqual(t.machine_rtp_from_player_data([{'bet':100,'pay':264}]),264.0)
    def test_no_bets_does_not_fake_zero_rtp(self):
        self.assertIsNone(t.machine_rtp_from_player_data([]))
        self.assertIsNone(t.machine_rtp_from_player_data([{'bet':0,'pay':0}]))
    def test_missing_pay_or_bad_value_disables_publication(self):
        with self.assertRaises(t.B2BError):
            t.machine_rtp_from_player_data([{'bet':123}])
        with self.assertRaises(t.B2BError):
            t.machine_rtp_from_player_data([{'bet':300,'pay':'not a number'}])
    def test_rtp_includes_all_machine_players_not_only_registrants(self):
        all_rows=[
            {'aId':'1000000081','nickname':'乙','bet':100,'pay':100},
            {'aId':'1000000183','nickname':'甲','bet':900,'pay':450}]
        leaders,_,_=t.summary_bet_rankings(all_rows,['1000000081'],restrict_registered=True)
        self.assertEqual(len(leaders),1)
        self.assertEqual(t.machine_rtp_from_player_data(all_rows),55.0)



class LuckyBoardTests(unittest.TestCase):
    def test_registered_only_and_correct_official_bet_count(self):
        data=[
          {'aId':'10000001','nickname':'甲','betCount':422,'bet':52100,'pay':46105},
          {'aId':'10000002','nickname':'乙','betCount':1201,'bet':601000,'pay':491394},
          {'aId':'99999999','nickname':'未登記','betCount':999999,'bet':9999999,'pay':99999999}]
        p=t.build_luckboard_for_all(data,['10000001','10000002'])
        self.assertEqual(len(p),2)
        self.assertEqual(p['10000001']['spins'],422)
        ranks=t.luckboard_sorted(p,['10000001','10000002'])
        self.assertEqual(ranks[0]['nickname'],'甲')
        self.assertEqual(ranks[0]['rtp'],88.49)
        self.assertNotIn('aId',str(ranks))
        self.assertNotIn('99999999',str(ranks))
    def test_merged_two_games_weighted_rtp_by_private_aid(self):
        set2={'000123':{'nickname':'同暱稱','spins':4,'bet':100,'pay':200},
              '000234':{'nickname':'同暱稱','spins':5,'bet':100,'pay':50}}
        thor={'000123':{'nickname':'同暱稱','spins':6,'bet':900,'pay':450}}
        ranks=t.merge_luckboard(set2,thor,['000123','000234'])
        a=next(x for x in ranks if x['spins']==10)
        self.assertEqual(a['bet'],1000)
        self.assertEqual(a['rtp'],65.0)
        self.assertEqual(a['rank'],1)
        self.assertEqual(len(ranks),2)
        self.assertEqual(ranks[1]['rtp'],50.0)
    def test_all_registered_participants_without_bets_visible_but_unranked(self):
        data={'000123':{'nickname':'已下注','spins':1,'bet':2,'pay':0}}
        ranks=t.luckboard_sorted(data,['000123','000234'])
        self.assertEqual(len(ranks),2)
        self.assertEqual(ranks[0]['rtp'],0.0)
        self.assertEqual(ranks[0]['rank'],1)
        self.assertEqual(ranks[1]['rtp'],None)
        self.assertEqual(ranks[1]['rank'],None)
        self.assertEqual(ranks[1]['bet'],0)
    def test_invalid_spin_field_fails_closed(self):
        bad=[{'aId':'000123','nickname':'Bad','bet':30,'pay':20}]
        with self.assertRaises(t.B2BError):
            t.build_luckboard_for_all(bad,['000123'])
        bad=[{'aId':'000123','nickname':'Bad','betCount':2.1,'bet':30,'pay':20}]
        with self.assertRaises(t.B2BError):
            t.build_luckboard_for_all(bad,['000123'])
    def test_no_bet_zero_rtp_not_misrepresented(self):
        rows=[{'aId':'000123','nickname':'未開轉','betCount':0,'bet':0,'pay':0}]
        p=t.build_luckboard_for_all(rows,['000123'])
        self.assertIsNone(t.luckboard_sorted(p,['000123'])[0]['rtp'])

if __name__=='__main__': unittest.main()
