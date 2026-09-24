from captionlive.export import to_srt, to_txt, to_vtt
from captionlive.models import CaptionEvent


def ev(text, ts, seq):
    return CaptionEvent(type="final", session="s", lang="es", text=text, ts=ts, seq=seq)


EVENTS = [ev("Hola a todos.", 1000.0, 1), ev("Bienvenidos a Nerdearla.", 1003.2, 2)]


def test_srt():
    out = to_srt(EVENTS)
    assert out.startswith("1\n00:00:00,000 --> 00:00:01,500\nHola a todos.\n")
    assert "2\n00:00:03,200 --> 00:00:04,800\nBienvenidos a Nerdearla." in out


def test_vtt():
    out = to_vtt(EVENTS)
    assert out.startswith("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHola a todos.")


def test_overlapping_cues_are_clipped():
    out = to_srt([ev("a" * 100, 0.0, 1), ev("b", 2.0, 2)])
    assert "00:00:00,000 --> 00:00:02,000" in out


def test_txt_and_empty():
    assert to_txt(EVENTS) == "Hola a todos.\nBienvenidos a Nerdearla.\n"
    assert to_txt([]) == "" and to_srt([]) == "" and to_vtt([]) == "WEBVTT\n"
