from fastapi import FastAPI
from .core.config import settings
from .db.init_db import init_models
from .api.routes import router as api_router
from .core.bootstrap import register_plugins
from .scheduler.loop import scheduler

app = FastAPI(title="AgentPilot", version="0.1.0")

@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.env}

@app.on_event("startup")
async def on_startup() -> None:
    register_plugins()
    await init_models()
    await scheduler.load_jobs()
    scheduler.start()

@app.on_event("shutdown")
async def on_shutdown() -> None:
    scheduler.shutdown()

app.include_router(api_router, prefix="/api")
