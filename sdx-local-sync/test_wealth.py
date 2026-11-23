import unittest
from unittest.mock import patch
import sync_b2b as t

class TestWealthBoard(unittest.TestCase):
    def setUp(self):
        self.aids=['1000000081','1000000183','1000000184','1000000185']
        self.rows={
            '1000000081':{'a_id':'1000000081','nickname':'米卡莎','money':1200.1234},
            '1000000183':{'a_id':'1000000183','nickname':'幸運者','money':0.2},
            '1000000184':{'a_id':'1000000184','nickname':'雷霆','money':9999.99},
            '1000000185':{'a_id':'1000000185','nickname':'金庫','money':1200.1234},
        }
        self.calls=[]
        class API:
            def __init__(inner):pass
            def call(inner,endpoint,args):
                self.calls.append((endpoint,args['searchContent']))
                row=self.rows.get(args['searchContent'])
                return {'total':1 if row else 0,'data':[row] if row else []}
        self.api=API()
        self.per_game={
            'SET2':{'1000000184':{'bet':500,'pay':800,'nickname':'雷霆'}},
            'THOR':{'1000000081':{'bet':200,'pay':80,'nickname':'米卡莎'}},
        }
        self.cfg={}
        self.event={'epoch':11,'phase':'CCB'}

    def test_wealth_is_descending_current_wallet_and_wallet_checked_once(self):
        with patch.object(t,'read_bankrupt_order',return_value=[]),patch.object(t,'save_bankrupt_order'):
            bankruptcy,wealth=t.build_bankruptcy_board(self.api,self.aids,self.event,
                self.per_game,self.cfg,include_wealth=True)
        self.assertEqual(wealth['status'],'ready')
        self.assertEqual((wealth['total'],wealth['checked'],len(wealth['rows'])),(4,4,4))
        self.assertEqual([x['nickname'] for x in wealth['rows']],['雷霆','米卡莎','金庫','幸運者'])
        self.assertEqual(wealth['rows'][0]['balance'],9999.99)
        self.assertEqual(wealth['rows'][0]['setNet'],300)
        self.assertEqual(wealth['rows'][1]['thorNet'],-120)
        self.assertEqual(wealth['rows'][-1]['balance'],0.2)
        self.assertEqual(bankruptcy['count'],1)
        self.assertEqual([item[0] for item in self.calls],['player/list']*4)
        for aid in self.aids:self.assertNotIn(aid,str(wealth))
        self.assertNotIn('money',str(wealth))

    def test_wallet_failure_makes_both_boards_unavailable(self):
        self.rows['1000000184']['money']='not-a-number'
        with patch.object(t,'read_bankrupt_order',return_value=[]):
            bankruptcy,wealth=t.build_bankruptcy_board(self.api,self.aids,self.event,
                self.per_game,self.cfg,include_wealth=True)
        self.assertEqual(bankruptcy['status'],'unavailable')
        self.assertEqual(wealth,{'status':'unavailable','total':4,'checked':0,'rows':[]})

    def test_legacy_bankruptcy_only_call_is_unchanged(self):
        with patch.object(t,'read_bankrupt_order',return_value=[]),patch.object(t,'save_bankrupt_order'):
            output=t.build_bankruptcy_board(self.api,self.aids,self.event,self.per_game,self.cfg)
        self.assertIsInstance(output,dict)
        self.assertNotIn('wealth',output)

    def test_zero_registration_no_invented_wealth(self):
        bankruptcy,wealth=t.build_bankruptcy_board(self.api,[],self.event,self.per_game,self.cfg,include_wealth=True)
        self.assertEqual(wealth,{'status':'ready','total':0,'checked':0,'rows':[]})
        self.assertEqual(bankruptcy['count'],0)

if __name__=='__main__':unittest.main()
