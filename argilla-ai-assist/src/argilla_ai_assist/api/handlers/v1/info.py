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

from fastapi import APIRouter

from argilla_ai_assist._version import __version__
from argilla_ai_assist.api.schemas.v1.info import Status, Version
from argilla_ai_assist.settings import settings

router = APIRouter(tags=["info"])


@router.get("/version", response_model=Version)
async def get_version():
    return Version(version=__version__)


@router.get("/status", response_model=Status)
async def get_status():
    # Check if backend is available (will be set by app factory)
    from argilla_ai_assist._app import get_backend
    backend = get_backend()
    
    return Status(
        version=__version__,
        model_id=settings.model_id,
        device=settings.device,
        model_loaded=backend is not None
    )
