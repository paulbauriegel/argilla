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
Common environment vars / settings for argilla-ai-assist
"""

import os
import re
import warnings
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Main application settings. The pydantic BaseSettings class makes
    accessible environment variables by setting attributes.

    Environment variables are prefixed with ARGILLA_AI_ASSIST_
    """

    # Model settings
    model_id: str = Field(
        default="facebook/sam3",
        description="Hugging Face model ID for SAM3"
    )
    device: str = Field(
        default="auto",
        description="Device to run model on (cpu, cuda, auto)"
    )

    # Server settings
    host: str = Field(
        default="0.0.0.0",
        description="Host to bind the server to"
    )
    port: int = Field(
        default=6950,
        description="Port to bind the server to"
    )
    cors_origins: List[str] = Field(
        default=["*"],
        description="List of allowed CORS origins"
    )

    # Database settings (for shared auth)
    database_url: Optional[str] = Field(
        default=None,
        description="Database URL for authentication (must match argilla-server)"
    )
    database_sqlite_timeout: Optional[int] = Field(
        default=30,
        description="SQLite database connection timeout in seconds"
    )

    # Authentication settings (must match argilla-server)
    secret_key: str = Field(
        description="Secret key for JWT token signing (must match argilla-server)"
    )
    algorithm: str = Field(
        default="HS256",
        description="JWT algorithm (must match argilla-server)"
    )
    token_expiration: int = Field(
        default=24 * 60 * 60,  # 1 day
        description="JWT token expiration in seconds"
    )

    # Model inference settings
    threshold: float = Field(
        default=0.5,
        description="Confidence threshold for instance segmentation"
    )
    mask_threshold: float = Field(
        default=0.5,
        description="Mask threshold for binary mask generation"
    )

    @field_validator("device", mode="before")
    @classmethod
    def normalize_device(cls, device: str) -> str:
        """Normalize device string to lowercase"""
        if device:
            return device.lower()
        return "auto"

    @field_validator("database_url", mode="before")
    @classmethod
    def set_database_url(cls, database_url: str) -> str:
        """Set default database URL if not provided"""
        if not database_url:
            # Default to SQLite in current directory
            home_path = Path.cwd()
            sqlite_file = os.path.join(home_path, "argilla.db")
            return f"sqlite+aiosqlite:///{sqlite_file}?check_same_thread=False"

        if "sqlite" in database_url:
            regex = re.compile(r"sqlite(?!\+aiosqlite)")
            if regex.match(database_url):
                warnings.warn(
                    "From version 0.1.0, argilla-ai-assist will use `aiosqlite` as default SQLite driver. "
                    "The protocol in the provided database URL has been automatically replaced from `sqlite` to `sqlite+aiosqlite`. "
                    "Please, update your database URL to use `sqlite+aiosqlite` protocol."
                )
                return re.sub(regex, "sqlite+aiosqlite", database_url)

        return database_url

    @model_validator(mode="after")
    @classmethod
    def create_database_file(cls, instance: "Settings") -> "Settings":
        """Create database file if using SQLite"""
        if instance.database_url and "sqlite+aiosqlite" in instance.database_url:
            # Extract file path from SQLite URL
            file_path = instance.database_url.split("///")[1].split("?")[0]
            Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        return instance

    @property
    def database_engine_args(self) -> Dict:
        """Get database engine arguments based on database type"""
        if self.database_url and "sqlite+aiosqlite" in self.database_url:
            return {
                "connect_args": {
                    "timeout": self.database_sqlite_timeout,
                },
            }
        return {}

    @property
    def database_is_sqlite(self) -> bool:
        """Check if database is SQLite"""
        if self.database_url is None:
            return False
        return self.database_url.lower().startswith("sqlite+aiosqlite")

    class Config:
        env_prefix = "ARGILLA_AI_ASSIST_"


settings = Settings()
