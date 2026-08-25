"""Keep the test suite off the real database.

WHY THIS FILE EXISTS: `app/database.py` calls `load_dotenv()` at import time,
and there is now a `.env` beside it holding the production Supabase URL.
Without this file every test run connected to that database - the FastAPI
lifespan alone issues `create_all` plus the additive column guard, so simply
constructing a TestClient ran schema DDL against production. It also made the
suite roughly twenty-five times slower (8s to 207s), because each test's setup
paid for a round trip to another continent, and it meant the tests could not
run at all without credentials or a network.

`load_dotenv()` does not override variables that are already set, so pointing
this one at an in-memory SQLite database BEFORE anything imports
`app.database` is enough to win. That import happens when the first test module
is collected, and conftest is loaded before any of them.

Individual tests still override `get_db` with their own session for isolation;
this covers the engine that the lifespan and any non-overridden code path use.
"""
from __future__ import annotations

import os

# Must run at import time - before pytest collects any test module, since
# collecting one imports app.database and freezes DATABASE_URL.
# Set unconditionally, NOT setdefault. Anyone with PREDICTIVE_DATABASE_URL
# already exported in their shell - which is normal when running the seeders or
# poking at the live data - would otherwise have the whole suite silently run
# against production, and the only symptom is that it got slow.
os.environ["PREDICTIVE_DATABASE_URL"] = "sqlite://"

# The auth module reads these too. Values are irrelevant - no test should reach
# a real token check - but leaving them unset changes which branch runs, and a
# test that passes for the wrong reason is worse than one that fails.
os.environ["SUPABASE_URL"] = "https://testproject.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "test-anon-key"

# Never let a real key make the suite call OpenAI: that would cost money per
# run and make the tests depend on a third party being reachable.
os.environ["OPENAI_API_KEY"] = ""
