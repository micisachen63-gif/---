import io
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch,MagicMock
import sync_b2b as m

class StartupFlowTests(unittest.TestCase):
    def run_main(self, login_failure=False):
        stream=io.StringIO()
        timeline=[]
        def fake_set_status(state,*args):
            timeline.append(state)
        def fake_backend(account,password):
            if login_failure:raise m.B2BError('B2B 登入未成功')
            return object()
        with patch.object(sys,'argv',['sync_b2b.py','--loop','--interval','90']),\
             patch.object(m,'read_config',return_value={'account':'test-account'}),\
             patch.object(m.getpass,'getpass',return_value='local-test-only'),\
             patch.object(m,'Backend',side_effect=fake_backend),\
             patch.object(m,'set_status',side_effect=fake_set_status),\
             patch.object(m.threading,'Thread') as thread,\
             patch.object(m,'create_snapshot',return_value=({'ok':True},{})),\
             patch.object(m,'print_report'),\
             patch.object(m,'publish'),\
             patch.object(m.time,'sleep',side_effect=KeyboardInterrupt),\
             redirect_stdout(stream):
            if login_failure:
                with self.assertRaises(m.B2BError):
                    m.main()
            else:
                self.assertEqual(m.main(),0)
        return stream.getvalue(),timeline
    def test_successful_login_and_sync_has_immediate_feedback(self):
        shown,stages=self.run_main()
        for expected in ['已收到密碼','正在驗證 B2B 登入','第 1 輪同步開始','正在同步到 Render 與 Google Sheets','下次約']:
            self.assertIn(expected,shown)
        self.assertEqual(stages[:2],['logging_in','authenticated'])
        self.assertIn('published',stages)
    def test_login_failure_still_show_where_it_stopped(self):
        shown,stages=self.run_main(login_failure=True)
        self.assertIn('已收到密碼',shown)
        self.assertEqual(stages,['logging_in'])

if __name__=='__main__':
    unittest.main()
