import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import sync_b2b as t

class MockMemberBackend:
    def __init__(self,people):self.people=people
    def call(self,endpoint,params):
        if endpoint!='player/list':raise AssertionError('unexpected endpoint')
        item=self.people.get(params['searchContent'])
        return {'total':1 if item else 0,'data':[item] if item else []}

class BankruptcyBoardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.guard=patch.object(t,'BANKRUPT_ORDER_FILE',Path(self.tmp.name)/'bankrupt_order.local.json')
        self.guard.start()
        self.ids=['1000000081','1000000183','1000000184']
        self.member={
            '1000000081':{'a_id':'1000000081','nickname':'阿金','coin':'4.99'},
            '1000000183':{'a_id':'1000000183','nickname':'雷雷','coin':0},
            '1000000184':{'a_id':'1000000184','nickname':'沒破產','coin':5},
        }
        self.event={'epoch':7,'phase':'CCB'}
        self.per_game={
            'SET2':{'1000000081':{'nickname':'阿金','bet':120,'pay':30},
                    '1000000183':{'nickname':'雷雷','bet':300,'pay':310}},
            'THOR':{'1000000081':{'nickname':'阿金','bet':90,'pay':170},
                    '1000000183':{'nickname':'雷雷','bet':240,'pay':10}}
        }
    def tearDown(self):
        self.guard.stop();self.tmp.cleanup()
    def test_real_member_wallet_boundary_and_two_game_net(self):
        b=t.build_bankruptcy_board(MockMemberBackend(self.member),self.ids,self.event,self.per_game,{})
        self.assertEqual(b['status'],'ready')
        self.assertEqual((b['count'],b['total'],b['percentage']),(2,3,66.67))
        self.assertEqual((b['rows'][0]['rank'],b['rows'][0]['ordinal']),(1,1))
        self.assertEqual((b['rows'][0]['setNet'],b['rows'][0]['thorNet']),(-90,80))
        self.assertEqual((b['rows'][1]['setNet'],b['rows'][1]['thorNet']),(10,-230))
        self.assertEqual(b['rows'][0]['aidMasked'],'******0081')
        self.assertNotIn(self.ids[0],str(b))
        self.assertNotIn(self.ids[1],str(b))
    def test_ordinal_survives_refresh_and_epoch_reset(self):
        api=MockMemberBackend(self.member)
        t.build_bankruptcy_board(api,self.ids,self.event,self.per_game,{})
        self.member['1000000081']['coin']=9
        self.member['1000000184']['coin']=0.99
        b=t.build_bankruptcy_board(api,self.ids,self.event,self.per_game,{})
        self.assertEqual([(r['rank'],r['ordinal']) for r in b['rows']],[(1,2),(2,3)])
        b=t.build_bankruptcy_board(api,self.ids,{'epoch':8},self.per_game,{})
        self.assertEqual([(r['rank'],r['ordinal']) for r in b['rows']],[(1,1),(2,2)])
    def test_unknown_wallet_fields_do_not_fabricate_zero_bankruptcy(self):
        for aid in self.ids:self.member[aid].pop('coin')
        b=t.build_bankruptcy_board(MockMemberBackend(self.member),self.ids,self.event,self.per_game,{})
        self.assertEqual(b['status'],'unavailable')
        self.assertIsNone(b['count'])
        self.assertIsNone(b['percentage'])
        self.assertEqual(b['rows'],[])
    def test_wallet_mismatch_does_not_publish_partial_results(self):
        self.member['1000000183']['coin']='no such balance'
        b=t.build_bankruptcy_board(MockMemberBackend(self.member),self.ids,self.event,self.per_game,{})
        self.assertEqual(b['status'],'unavailable')
        self.assertEqual(b['checked'],0)
    def test_exact_aid_match_and_explicit_wallet_field(self):
        self.member['1000000081']['coin']=4
        self.member['1000000081']['gold']=400
        with self.assertRaises(t.B2BError):
            t.member_coin_balance(MockMemberBackend(self.member),'1000000081')
        balance,name=t.member_coin_balance(MockMemberBackend(self.member),'1000000081','coin')
        self.assertEqual((balance,name),(4,'阿金'))
        self.member['1000000081']['a_id']='1111111111'
        with self.assertRaises(t.B2BError):
            t.member_coin_balance(MockMemberBackend(self.member),'1000000081')
    def test_160_participants_uses_consistent_half_up_percentage(self):
        aids=['2000000'+str(i).zfill(4) for i in range(160)]
        people={aid:{'a_id':aid,'nickname':'測試','coin':0 if i==0 else 5}
                for i,aid in enumerate(aids)}
        result=t.build_bankruptcy_board(MockMemberBackend(people),aids,self.event,{}, {})
        self.assertEqual((result['count'],result['total'],result['percentage']),(1,160,0.63))
    def test_zero_registered_is_exact_zero_percent(self):
        b=t.build_bankruptcy_board(MockMemberBackend({}),[],self.event,self.per_game,{})
        self.assertEqual((b['count'],b['total'],b['percentage']),(0,0,0))

if __name__=='__main__': unittest.main()
