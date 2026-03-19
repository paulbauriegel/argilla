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

import base64
import pytest
from unittest.mock import AsyncMock, patch
from fastapi import status

from argilla_ai_assist.api.schemas.v1.predictions import SegmentationRequest
from argilla_ai_assist.backends.base import PredictionResult


@pytest.mark.asyncio
async def test_segment_image_pcs_mode(client):
    """Test image segmentation in PCS mode (text prompt)"""
    # Create a simple test image
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    # Mock the backend
    mock_backend = AsyncMock()
    mock_backend.predict_pcs.return_value = PredictionResult(
        masks=[test_image],
        boxes=[[0.0, 0.0, 100.0, 100.0]],
        scores=[0.95],
        num_instances=1
    )
    
    with patch('argilla_ai_assist.api.handlers.v1.predictions.get_backend', return_value=mock_backend):
        response = await client.post(
            "/api/v1/predictions/segment",
            json={
                "image": test_image,
                "text": "cat"
            },
            headers={"Authorization": "Bearer valid-token"}
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["num_instances"] == 1
    assert len(data["masks"]) == 1
    assert len(data["boxes"]) == 1
    assert len(data["scores"]) == 1


@pytest.mark.asyncio
async def test_segment_image_pvs_mode(client):
    """Test image segmentation in PVS mode (point prompts)"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    # Mock the backend
    mock_backend = AsyncMock()
    mock_backend.predict_pvs.return_value = PredictionResult(
        masks=[test_image, test_image],
        boxes=[[0.0, 0.0, 100.0, 100.0], [50.0, 50.0, 150.0, 150.0]],
        scores=[1.0, 1.0],
        num_instances=2
    )
    
    with patch('argilla_ai_assist.api.handlers.v1.predictions.get_backend', return_value=mock_backend):
        response = await client.post(
            "/api/v1/predictions/segment",
            json={
                "image": test_image,
                "input_points": [[100, 100], [200, 200]],
                "input_labels": [1, 1]
            },
            headers={"Authorization": "Bearer valid-token"}
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["num_instances"] == 2
    assert len(data["masks"]) == 2
    assert len(data["boxes"]) == 2
    assert len(data["scores"]) == 2


@pytest.mark.asyncio
async def test_segment_image_invalid_request_no_prompts(client):
    """Test segmentation request with no prompts (should fail)"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    response = await client.post(
        "/api/v1/predictions/segment",
        json={
            "image": test_image
            # No prompts provided
        },
        headers={"Authorization": "Bearer valid-token"}
    )
    
    assert response.status_code == 422
    assert "Invalid request: must provide either text prompt, point prompts, or box labels" in response.json()["detail"]


@pytest.mark.asyncio
async def test_segment_image_invalid_base64(client):
    """Test segmentation request with invalid base64 image"""
    response = await client.post(
        "/api/v1/predictions/segment",
        json={
            "image": "invalid-base64-string",
            "text": "cat"
        },
        headers={"Authorization": "Bearer valid-token"}
    )
    
    assert response.status_code == 422
    assert "Invalid base64 image data" in response.json()["detail"]


@pytest.mark.asyncio
async def test_segment_image_backend_not_initialized(client):
    """Test segmentation when backend is not initialized"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    with patch('argilla_ai_assist.api.handlers.v1.predictions.get_backend', return_value=None):
        response = await client.post(
            "/api/v1/predictions/segment",
            json={
                "image": test_image,
                "text": "cat"
            },
            headers={"Authorization": "Bearer valid-token"}
        )
    
    assert response.status_code == 503
    assert "Backend not initialized" in response.json()["detail"]
