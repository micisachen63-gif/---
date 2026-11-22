import io
import queue
import threading
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import sync_b2b as m

class HeartbeatVerifierTests(unittest.TestCase):
    def make_state(self):
        stop=threading.Event()
        realwait=stop.wait
        stop.wait=lambda seconds:realwait(min(seconds,.018))
        jobs=queue.Queue(maxsize=64)
        queued=set()
        lock=threading.Lock()
        return stop,jobs,queued,lock

    def test_heartbeat_remains_online_while_b2b_account_lookup_blocks(self):
        stop,jobs,queued,lock=self.make_state()
        entered=threading.Event()
        release=threading.Event()
        polled=[]
        results=[]
        def receiver(path,payload=None):
            if path=='/api/verifier/jobs':
                polled.append(time.monotonic())
                return {'ok':True,'jobs':[{'requestId':'job-1','aid':'1000000081'}],
                        'event':{'phase':'CCB'}}
            assert path=='/api/verifier/result'
            results.append(payload)
            return {'ok':True,'status':'registered'}
        def slow_verify(api,aid):
            self.assertEqual(aid,'1000000081')
            entered.set()
            self.assertTrue(release.wait(2))
            return True
        # A real B2B lookup waits, but the independent poller must continue
        # sending authenticated heartbeat requests.
        with patch.object(m,'receiver_api',side_effect=receiver),\
             patch.object(m,'verify_exists_on_b2b',side_effect=slow_verify),\
             patch.object(m,'set_verifier_status') as health,\
             redirect_stdout(io.StringIO()):
            poll=threading.Thread(target=m.verifier_poller,
                    args=(stop,jobs,queued,lock),daemon=True)
            worker=threading.Thread(target=m.verifier_job_worker,
                    args=(object(),stop,jobs,queued,lock),daemon=True)
            poll.start();worker.start()
            try:
                self.assertTrue(entered.wait(1))
                start=time.monotonic()
                while len(polled)<4 and time.monotonic()-start<1:
                    time.sleep(.012)
                self.assertGreaterEqual(len(polled),4)
                self.assertEqual(len(queued),1,'duplicate jobs queued while first request is busy')
                self.assertTrue(health.called)
            finally:
                stop.set()
                release.set()
                poll.join(2);worker.join(2)
            self.assertFalse(poll.is_alive())
            self.assertFalse(worker.is_alive())
            self.assertEqual(results,[{'requestId':'job-1','exists':True}])

    def test_transient_render_error_recovers_without_killing_heartbeat(self):
        stop,jobs,queued,lock=self.make_state()
        calls=[]
        def receiver(path,payload=None):
            calls.append(path)
            if len(calls)<3:
                raise m.B2BError('simulated unavailable')
            if len(calls)>=5:stop.set()
            return {'ok':True,'jobs':[],'event':{'phase':'CCB'}}
        with patch.object(m,'receiver_api',side_effect=receiver),\
             patch.object(m,'set_verifier_status') as health,\
             redirect_stdout(io.StringIO()):
            m.verifier_poller(stop,jobs,queued,lock)
        self.assertGreaterEqual(len(calls),5)
        states=[call.args[0] for call in health.call_args_list]
        self.assertIn('reconnecting',states)
        self.assertIn('online',states)
        self.assertEqual(states[-1],'stopped')

    def test_unverified_aid_is_not_registered_when_b2b_unavailable(self):
        stop,jobs,queued,lock=self.make_state()
        jobs.put(('job-failed','1000000081'))
        responses=[]
        def receiver(path,payload=None):
            responses.append(payload)
            stop.set()
            return {'ok':True}
        def backend_error(api,aid):
            raise m.B2BError('B2B unavailable')
        with patch.object(m,'receiver_api',side_effect=receiver),\
             patch.object(m,'verify_exists_on_b2b',side_effect=backend_error),\
             redirect_stdout(io.StringIO()):
            m.verifier_job_worker(object(),stop,jobs,queued,lock)
        self.assertEqual(responses,[{'requestId':'job-failed','error':True}])
        self.assertEqual(queued,set())

    def test_b2b_account_session_is_serialized(self):
        backend=m.Backend.__new__(m.Backend)
        backend._call_lock=threading.RLock()
        backend.request=lambda endpoint,args:{'status':2,'data':{'id':1}}
        result=[]
        for _ in range(2):
            t=threading.Thread(target=lambda:result.append(backend.call('player/list',{})))
            t.start();t.join()
        self.assertEqual(result,[{'id':1},{'id':1}])

if __name__=='__main__':
    unittest.main()
