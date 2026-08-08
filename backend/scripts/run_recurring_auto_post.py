from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

from app.db.session import SessionLocal
from app.services.recurring_auto_post import process_due_auto_posts

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("recurring-auto-post")
INTERVAL_SECONDS = max(300, int(os.getenv("RECURRING_AUTO_POST_INTERVAL_SECONDS", "3600")))


def run_once() -> None:
    db = SessionLocal()
    try:
        posted, failed = process_due_auto_posts(db, now=datetime.now(timezone.utc))
        logger.info("Recurring Auto Post run complete: posted=%s failed=%s", posted, failed)
    except Exception:
        db.rollback()
        logger.exception("Recurring Auto Post run failed")
    finally:
        db.close()


def main() -> None:
    logger.info("Recurring Auto Post worker started; interval=%ss", INTERVAL_SECONDS)
    while True:
        run_once()
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
