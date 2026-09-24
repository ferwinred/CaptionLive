"""Turns interim/final ASR hypotheses into committed caption segments.

Why: ASR only finalises an utterance when the speaker pauses, and speakers on stage
often talk 15-20 s without pausing. Waiting for that pause before translating would
make translated captions lag far behind. With *early commit*, a sentence is
committed (and sent to translation) as soon as it is complete **and** unchanged in
two consecutive interim hypotheses. When the utterance is finalised we only commit
the words that were not committed yet.
"""

from __future__ import annotations

import re

# split after sentence punctuation followed by whitespace and a sentence start
_SPLIT = re.compile(r"(?<=[.!?…。？！])\s+(?=[\"'¿¡(\[]?[A-ZÁÉÍÓÚÑÜÀ-ÖØ-Þ0-9])")


def split_sentences(text: str) -> list[str]:
    text = " ".join(text.split())
    if not text:
        return []
    return [s for s in _SPLIT.split(text) if s]


class Segmenter:
    def __init__(self, early_commit: bool = True) -> None:
        self.early_commit = early_commit
        self.reset()

    def reset(self) -> None:
        self.committed_words = 0
        self._prev_complete: list[str] = []

    def _tail(self, text: str) -> str:
        return " ".join(text.split()[self.committed_words :])

    def interim(self, text: str) -> tuple[list[str], str]:
        """Return (sentences to commit now, uncommitted tail to display)."""
        commits: list[str] = []
        if self.early_commit:
            tail = self._tail(text)
            sentences = split_sentences(tail)
            complete = sentences[:-1]  # the last one may still be growing
            prev = self._prev_complete
            for i, sentence in enumerate(complete):
                if i < len(prev) and prev[i] == sentence:
                    commits.append(sentence)
                else:
                    break
            if commits:
                self.committed_words += sum(len(s.split()) for s in commits)
            self._prev_complete = complete[len(commits) :]
        return commits, self._tail(text)

    def final(self, text: str) -> str:
        """Return the not-yet-committed remainder of a finished utterance."""
        remainder = self._tail(text)
        self.reset()
        return remainder
