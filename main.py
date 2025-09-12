# main.py
"""
Minimal main that only mounts the simulator router (and optional ai mocks).
Uses FastAPI lifespan for startup seeding (no deprecated @app.on_event).
Run:
  uvicorn main:app --reload --port 8000
"""
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env in development (no-op if python-dotenv not configured with a file)
# pip install python-dotenv
try:
    from dotenv import load_dotenv
    load_dotenv()  # loads .env from project root if present
except Exception:
    # If python-dotenv isn't installed, it's fine — environment variables may come from the environment
    pass

# Attempt to import simulator router and seeder
simulator_router = None
_do_seed_all_rules = None
try:
    from humaein_sim import router as simulator_router, _do_seed_all_rules
except Exception:
    simulator_router = None
    _do_seed_all_rules = None

# Attempt to import ai_mocks router (optional)
ai_router = None
try:
    from ai_mocks import router as ai_router
except Exception:
    ai_router = None

# Logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("humaein_main")

# Read configuration from environment (safe defaults for dev)
# FRONTEND_ORIGINS is a comma-separated list like:
# "http://192.168.44.109:8080,http://localhost:8080"
FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
origins = [o.strip() for o in FRONTEND_ORIGINS.split(",") if o.strip()]

# We also read BACKEND_HOST/BACKEND_PORT purely for informational logging.
# The actual binding is done by the uvicorn process (see run instructions).
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

app = FastAPI(title="Humaein RCM - Simulator Only")

log.info("Configured FRONTEND_ORIGINS: %s", origins)
log.info("Configured BACKEND_HOST: %s, BACKEND_PORT: %s", BACKEND_HOST, BACKEND_PORT)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the simulator router ONLY (no orchestrator)
if simulator_router:
    app.include_router(simulator_router, prefix="/simulator/humaein")
    log.info("Mounted humaein_sim router at /simulator/humaein")
else:
    log.warning("humaein_sim not importable — simulator endpoints will not be present. Check PYTHONPATH.")

# Mount AI mocks if available
if ai_router:
    app.include_router(ai_router, prefix="/ai")
    log.info("Mounted ai_mocks at /ai")
else:
    log.info("ai_mocks not found (optional).")

@app.get("/_healthz")
def healthz():
    return {"ok": True, "simulator_present": simulator_router is not None, "ai_mocks_present": ai_router is not None}

# Use lifespan context for seeding (no deprecated on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: seed simulator if available
    try:
        if _do_seed_all_rules:
            try:
                cnt = _do_seed_all_rules()
                log.info("Simulator auto-seeded %d rules at startup", cnt)
            except Exception as e:
                log.exception("Simulator seeding at startup failed: %s", e)
        else:
            log.info("No simulator seeder available; skipping seed.")
    except Exception as e:
        log.exception("Unexpected startup error: %s", e)
    yield
    # Shutdown
    log.info("Humaein main shutting down.")

app.router.lifespan_context = lifespan
