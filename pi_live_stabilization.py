from __future__ import annotations

from collections import Counter, deque
from statistics import median


class Stabilizer:
    def __init__(self, mode: str = "consecutive", window: int = 3, consecutive_required: int = 2):
        self.mode, self.required = mode, max(1, consecutive_required)
        self.values: deque[str] = deque(maxlen=max(1, window))
        self.stable: str | None = None

    def add(self, value: str) -> tuple[str | None, bool]:
        self.values.append(value)
        candidate = None
        if self.mode == "consecutive":
            if len(self.values) >= self.required and len(set(list(self.values)[-self.required:])) == 1:
                candidate = value
        elif self.mode == "majority":
            candidate, count = Counter(self.values).most_common(1)[0]
            candidate = candidate if count > len(self.values) / 2 else None
        elif self.mode == "median":
            try:
                candidate = str(median(float(v) for v in self.values))
            except ValueError:
                candidate = None
        else:
            candidate = value
        changed = candidate is not None and candidate != self.stable
        if candidate is not None:
            self.stable = candidate
        return self.stable, changed
