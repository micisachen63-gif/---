import unittest
import sync_b2b as sync

class CadenceTests(unittest.TestCase):
    def test_start_to_start_cadence_is_ninety_seconds(self):
        self.assertEqual(sync.next_sync_wait(90, 30), 60)
        self.assertEqual(sync.next_sync_wait(90, 70), 20)
        self.assertEqual(sync.next_sync_wait(120, 40), 80)
        self.assertEqual(sync.next_sync_wait(60, 2), 58)

    def test_slow_b2b_cycle_never_overlaps_or_busy_retries(self):
        self.assertEqual(sync.next_sync_wait(90, 95), 10)
        self.assertEqual(sync.next_sync_wait(90, 300), 10)
        self.assertEqual(sync.next_sync_wait(90, 100, min_gap=15), 15)

    def test_clock_noise_is_nonnegative(self):
        self.assertEqual(sync.next_sync_wait(90, -10), 90)

if __name__=='__main__':
    unittest.main()
