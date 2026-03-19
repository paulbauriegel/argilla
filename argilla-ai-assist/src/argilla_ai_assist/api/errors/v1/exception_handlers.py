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

from typing import Optional

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi import Request


def set_request_error(request: Request, error: Exception) -> None:
    """Store the error in the request scope for further processing"""
    request.state.error = error


def get_request_error(request: Request) -> Optional[Exception]:
    """Get the error stored in the request scope"""
    return getattr(request.state, "error", None)


def add_exception_handlers(app: FastAPI):
    """Add exception handlers to the FastAPI app"""
    
    @app.exception_handler(ValueError)
    async def value_error_exception_handler(request: Request, exc: ValueError):
        set_request_error(request, exc)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": str(exc)},
        )
    
    @app.exception_handler(RuntimeError)
    async def runtime_error_exception_handler(request: Request, exc: RuntimeError):
        set_request_error(request, exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": str(exc)},
        )
    
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        set_request_error(request, exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )
