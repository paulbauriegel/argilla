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

"""
This module configures the api routes under /api prefix
"""

from fastapi import FastAPI

from argilla_ai_assist._version import __version__
from argilla_ai_assist.api.errors.v1.exception_handlers import add_exception_handlers
from argilla_ai_assist.api.handlers.v1 import info as info_v1
from argilla_ai_assist.api.handlers.v1 import predictions as predictions_v1


def create_api_v1():
    """Create API v1 FastAPI sub-app"""
    api_v1 = FastAPI(
        title="Argilla AI Assist v1",
        description="Argilla AI Assist API v1",
        version=str(__version__),
    )
    
    # Add exception handlers
    add_exception_handlers(api_v1)
    
    # Add routers
    api_v1.include_router(info_v1.router)
    api_v1.include_router(predictions_v1.router)
    
    return api_v1


api_v1 = create_api_v1()
