#  coding=utf-8
#  Copyright 2021-present, the Recognai S.L. team.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

import contextlib
import logging

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from argilla_ai_assist._version import __version__
from argilla_ai_assist.api.routes import api_v1
from argilla_ai_assist.backends import SAM3Backend
from argilla_ai_assist.database import create_tables
from argilla_ai_assist.settings import settings

_LOGGER = logging.getLogger(__name__)

# Global backend instance
_backend: SAM3Backend = None


def get_backend():
    """Get the global backend instance"""
    return _backend


@contextlib.asynccontextmanager
async def app_lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    _LOGGER.info("Starting argilla-ai-assist...")
    
    # Initialize database tables
    await create_tables()
    _LOGGER.info("Database tables created")
    
    # Initialize backend
    global _backend
    _backend = SAM3Backend()
    await _backend.initialize()
    _LOGGER.info("Backend initialized successfully")
    
    yield
    
    # Shutdown
    _LOGGER.info("Shutting down argilla-ai-assist...")
    if _backend:
        await _backend.cleanup()
        _LOGGER.info("Backend cleaned up")


def configure_common_middleware(app: FastAPI):
    """Configure FastAPI middleware"""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def create_server_app() -> FastAPI:
    """Create and configure the FastAPI application"""
    app = FastAPI(
        title="Argilla AI Assist",
        description="AI prediction service for Argilla",
        version=str(__version__),
        lifespan=app_lifespan,
    )
    
    # Configure middleware
    configure_common_middleware(app)
    
    # Mount API routes
    app.mount("/api/v1", api_v1)
    
    return app


# Create the app instance
app = create_server_app()
