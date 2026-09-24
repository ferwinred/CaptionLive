from captionlive.audio import duration_seconds, level_dbfs, resample_pcm16

from .conftest import silence, tone


def test_resample_changes_length_proportionally():
    data = tone(1.0, rate=48000)
    out = resample_pcm16(data, 48000, 16000)
    assert abs(len(out) / 2 - 16000) <= 1
    assert resample_pcm16(data, 16000, 16000) is data


def test_resample_44k1_keeps_duration():
    data = tone(0.5, rate=44100)
    out = resample_pcm16(data, 44100, 16000)
    assert abs(duration_seconds(out, 16000) - 0.5) < 0.001


def test_level():
    assert level_dbfs(silence(0.1)) == -90.0
    loud = level_dbfs(tone(0.1, amp=0.5))
    assert -10 < loud < -5  # sine RMS = amp/sqrt(2) -> ~ -9 dBFS
    assert level_dbfs(b"") == -90.0
    assert level_dbfs(b"\x01") == -90.0  # odd byte count tolerated
