from fastapi import APIRouter

from apps.api.app.api.automation import router as automation_router
from apps.api.app.api.command_tower import router as command_tower_router
from apps.api.app.api.computer_use import router as computer_use_router
from apps.api.app.api.embeddings import router as embeddings_router
from apps.api.app.api.evidence_runs import router as evidence_runs_router
from apps.api.app.api.flows import router as flows_router
from apps.api.app.api.health import router as health_router
from apps.api.app.api.integrations_vonage import router as integrations_vonage_router
from apps.api.app.api.profiles import router as profiles_router
from apps.api.app.api.register import router as register_router
from apps.api.app.api.reconstruction import router as reconstruction_router
from apps.api.app.api.runs import router as runs_router
from apps.api.app.api.sessions import router as sessions_router
from apps.api.app.api.templates import router as templates_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(integrations_vonage_router)
api_router.include_router(register_router)
api_router.include_router(automation_router)
api_router.include_router(command_tower_router)
api_router.include_router(computer_use_router)
api_router.include_router(embeddings_router)
api_router.include_router(evidence_runs_router)
api_router.include_router(reconstruction_router)
api_router.include_router(profiles_router)
api_router.include_router(sessions_router)
api_router.include_router(flows_router)
api_router.include_router(templates_router)
api_router.include_router(runs_router)
