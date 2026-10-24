from fastapi import APIRouter

from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.compliance import router as compliance_router
from app.api.dashboard import router as dashboard_router
from app.api.review import router as review_router
from app.api.users import router as users_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router)
api_router.include_router(compliance_router)
api_router.include_router(dashboard_router)
api_router.include_router(applications_router)
api_router.include_router(review_router)
api_router.include_router(users_router)
