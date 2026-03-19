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
import io
import logging
from typing import Optional

from fastapi import APIRouter, Security, status
from PIL import Image
from starlette.requests import Request

from argilla_ai_assist.api.schemas.v1.predictions import SegmentationRequest, SegmentationResponse
from argilla_ai_assist.models import User
from argilla_ai_assist.security import auth

_LOGGER = logging.getLogger(__name__)

router = APIRouter(tags=["predictions"])


def decode_base64_image(base64_str: str) -> Image.Image:
    """Decode base64 string to PIL Image"""
    # Remove data URL prefix if present
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    
    try:
        image_bytes = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_bytes))
        return image.convert("RGB")
    except Exception as e:
        _LOGGER.error(f"Failed to decode base64 image: {e}")
        raise ValueError("Invalid base64 image data")


def determine_inference_mode(request: SegmentationRequest) -> str:
    """Determine whether to use PCS or PVS mode based on request"""
    # PCS mode: text prompt or box labels provided
    if request.text or request.input_boxes_labels:
        return "pcs"
    
    # PVS mode: point prompts provided
    if request.input_points:
        return "pvs"
    
    raise ValueError(
        "Invalid request: must provide either text prompt, point prompts, or box labels"
    )


@router.post(
    "/predictions/segment",
    status_code=status.HTTP_200_OK,
    response_model=SegmentationResponse
)
async def segment_image(
    request: Request,
    segmentation_request: SegmentationRequest,
    current_user: User = Security(auth)
):
    """
    Segment an image using SAM3 model.
    
    Automatically selects PCS or PVS mode based on the provided prompts:
    - PCS mode: text prompt or box labels provided
    - PVS mode: point prompts provided
    """
    try:
        # Get backend instance
        from argilla_ai_assist._app import get_backend
        backend = get_backend()
        if not backend:
            raise RuntimeError("Backend not initialized")
        
        # Decode image
        image = decode_base64_image(segmentation_request.image)
        
        # Determine inference mode
        mode = determine_inference_mode(segmentation_request)
        _LOGGER.info(f"Using {mode.upper()} mode for segmentation request")
        
        # Run inference
        if mode == "pcs":
            result = await backend.predict_pcs(
                image=image,
                text=segmentation_request.text,
                input_boxes=segmentation_request.input_boxes,
                input_boxes_labels=segmentation_request.input_boxes_labels,
                threshold=segmentation_request.threshold or 0.5,
                mask_threshold=segmentation_request.mask_threshold or 0.5,
            )
        else:  # pvs mode
            result = await backend.predict_pvs(
                image=image,
                input_points=segmentation_request.input_points,
                input_labels=segmentation_request.input_labels,
                input_boxes=segmentation_request.input_boxes,
                threshold=segmentation_request.threshold or 0.5,
                mask_threshold=segmentation_request.mask_threshold or 0.5,
            )
        
        _LOGGER.info(f"Segmentation completed: {result.num_instances} instances detected")
        
        return SegmentationResponse(
            masks=result.masks,
            boxes=result.boxes,
            scores=result.scores,
            num_instances=result.num_instances
        )
        
    except Exception as e:
        _LOGGER.error(f"Segmentation request failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
