from captionlive.segmenter import Segmenter, split_sentences


def test_split_sentences():
    assert split_sentences("Hello world. This is a test? Yes! and") == [
        "Hello world.",
        "This is a test?",
        "Yes! and",
    ]
    # no split on decimals / lowercase continuations
    assert split_sentences("Version 1.2 is out. e.g. this") == ["Version 1.2 is out. e.g. this"]
    assert split_sentences("¿Qué tal? ¡Bien! Gracias.") == ["¿Qué tal?", "¡Bien!", "Gracias."]
    assert split_sentences("   ") == []


def test_no_early_commit_waits_for_final():
    seg = Segmenter(early_commit=False)
    commits, tail = seg.interim("First sentence. Second")
    assert commits == [] and tail == "First sentence. Second"
    assert seg.final("First sentence. Second one.") == "First sentence. Second one."


def test_early_commit_requires_stability():
    seg = Segmenter()
    assert seg.interim("Kubernetes is great. It")[0] == []  # seen once
    commits, tail = seg.interim("Kubernetes is great. It scales")  # stable twice -> commit
    assert commits == ["Kubernetes is great."]
    assert tail == "It scales"
    # later interims only show the uncommitted tail
    assert seg.interim("Kubernetes is great. It scales well")[1] == "It scales well"
    # final returns only what was not committed
    assert seg.final("Kubernetes is great. It scales well.") == "It scales well."
    # state resets for the next utterance
    assert seg.interim("Next one")[1] == "Next one"


def test_changed_sentence_is_not_committed():
    seg = Segmenter()
    seg.interim("Cube or natives. And")
    commits, _ = seg.interim("Kubernetes. And then")
    assert commits == []
    commits, _ = seg.interim("Kubernetes. And then we")
    assert commits == ["Kubernetes."]


def test_multiple_sentences_commit_in_order():
    seg = Segmenter()
    seg.interim("One. Two. Three")
    commits, tail = seg.interim("One. Two. Three four")
    assert commits == ["One.", "Two."]
    assert tail == "Three four"
