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
if __name__=='__main__': unittest.main()
