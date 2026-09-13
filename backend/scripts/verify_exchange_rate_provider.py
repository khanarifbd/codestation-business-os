from __future__ import annotations

import json
from urllib.error import URLError

from fastapi import HTTPException

from app.api.v1 import exchange_rates


class _Response:
    def __init__(self, payload: dict):
        self._data = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._data


def main() -> None:
    original = exchange_rates.urlopen
    try:
        captured: list[str] = []

        def fake_urlopen(request, timeout=10):
            captured.append(request.full_url)
            return _Response({"date": "2026-08-17", "base": "USD", "quote": "BDT", "rate": 123.4567})

        exchange_rates.urlopen = fake_urlopen
        rate = exchange_rates._fetch_frankfurter("USD", "BDT")
        assert str(rate) == "123.4567", rate
        assert captured == ["https://api.frankfurter.dev/v2/rate/USD/BDT"], captured

        def failing_urlopen(request, timeout=10):
            raise URLError("provider down")

        exchange_rates.urlopen = failing_urlopen
        try:
            exchange_rates._fetch_frankfurter("USD", "BDT")
            raise AssertionError("Provider failure must raise HTTP 503")
        except HTTPException as exc:
            assert exc.status_code == 503
            assert "temporarily unavailable" in str(exc.detail).lower()

        print("exchange-rate provider verification passed")
    finally:
        exchange_rates.urlopen = original


if __name__ == "__main__":
    main()
