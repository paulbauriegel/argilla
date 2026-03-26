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
SAM3 backend implementation using 🤗 Transformers
"""

import base64
import io
import logging
import os
from typing import List, Optional

import torch
import numpy as np
from PIL import Image
from transformers import Sam3Model, Sam3Processor, Sam3TrackerModel, Sam3TrackerProcessor
from huggingface_hub import login

from argilla_ai_assist.backends.base import BaseBackend, PredictionResult
from argilla_ai_assist.settings import settings


_LOGGER = logging.getLogger(__name__)


class SAM3Backend(BaseBackend):
    """SAM3 backend implementation"""
    
    def __init__(self):
        self._pcs_model = None  # Promptable Concept Segmentation
        self._pcs_processor = None
        self._pvs_model = None  # Promptable Visual Segmentation  
        self._pvs_processor = None
        self._device = None
    
    async def initialize(self) -> None:
        """Initialize SAM3 models"""
        _LOGGER.info("Initializing SAM3 backend...")
        
        # Login to Hugging Face if token is provided
        hf_token = os.getenv("HF_TOKEN")
        if hf_token:
            _LOGGER.info("Authenticating with Hugging Face...")
            login(token=hf_token)
        
        # Determine device
        if settings.device == "auto":
            if torch.cuda.is_available():
                self._device = "cuda"
            elif torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"
        else:
            self._device = settings.device
        
        _LOGGER.warning(f"Using device: {self._device}")
        
        try:
            # Load PCS model (text + box prompts)
            _LOGGER.info("Loading SAM3 PCS model...")
            self._pcs_model = Sam3Model.from_pretrained(settings.model_id).to(self._device)
            self._pcs_processor = Sam3Processor.from_pretrained(settings.model_id)
            
            # Load PVS model (point + box prompts)
            _LOGGER.info("Loading SAM3 PVS model...")
            self._pvs_model = Sam3TrackerModel.from_pretrained(settings.model_id).to(self._device)
            self._pvs_processor = Sam3TrackerProcessor.from_pretrained(settings.model_id)
            
            _LOGGER.info("SAM3 backend initialized successfully")
        except Exception as e:
            _LOGGER.error(f"Failed to load SAM3 model: {e}")
            _LOGGER.warning("Falling back to mock implementation. To use real SAM3:")
            _LOGGER.warning("1. Get a Hugging Face token from https://huggingface.co/settings/tokens")
            _LOGGER.warning("2. Set HF_TOKEN in your environment")
            _LOGGER.warning("3. Go to https://huggingface.co/facebook/sam3 and accept the terms")
            # Continue with mock implementation
            self._pcs_model = None
            self._pvs_model = None
    
    async def predict_pcs(
        self,
        image: Image.Image,
        text: Optional[str] = None,
        input_boxes: Optional[List[List[float]]] = None,
        input_boxes_labels: Optional[List[int]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """Predict using PCS mode (text + box prompts)"""
        if self._pcs_model and self._pcs_processor:
            # Use real SAM3
            try:
                # Prepare inputs
                inputs = {}
                
                if text:
                    inputs["text"] = text
                
                if input_boxes and input_boxes_labels:
                    # Convert to format expected by SAM3
                    inputs["input_boxes"] = [input_boxes]
                    inputs["input_boxes_labels"] = [input_boxes_labels]
                
                # Process image
                processed_inputs = self._pcs_processor(
                    images=image,
                    return_tensors="pt",
                    **inputs
                ).to(self._device)
                
                # Run inference
                with torch.no_grad():
                    outputs = self._pcs_model(**processed_inputs)
                
                # Post-process results
                results = self._pcs_processor.post_process_instance_segmentation(
                    outputs,
                    threshold=threshold,
                    mask_threshold=mask_threshold,
                    target_sizes=processed_inputs.get("original_sizes").tolist()
                )[0]
                
                # Convert masks to base64 PNGs
                masks_png = []
                for mask in results["masks"]:
                    mask_np = mask.cpu().numpy().astype(np.uint8) * 255
                    mask_img = Image.fromarray(mask_np, mode='L')
                    masks_png.append(self._image_to_base64_png(mask_img))
                
                return PredictionResult(
                    masks=masks_png,
                    boxes=results["boxes"].tolist(),
                    scores=results["scores"].tolist(),
                    num_instances=len(results["masks"])
                )
            except Exception as e:
                _LOGGER.error(f"SAM3 PCS prediction failed: {e}")
                # Fall back to mock
                return await self._mock_predict_pcs(image, text, input_boxes, input_boxes_labels, threshold, mask_threshold)
        else:
            # Use mock implementation
            return await self._mock_predict_pcs(image, text, input_boxes, input_boxes_labels, threshold, mask_threshold)
    
    async def _mock_predict_pcs(
        self,
        image: Image.Image,
        text: Optional[str] = None,
        input_boxes: Optional[List[List[float]]] = None,
        input_boxes_labels: Optional[List[int]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """Mock PCS prediction"""
        _LOGGER.warning("Using mock PCS prediction - real SAM3 not available")
        
        # Create a simple mock mask (center of image)
        width, height = image.size
        mask_array = np.zeros((height, width), dtype=np.uint8)
        
        # Create a simple rectangular mask in the center
        center_x, center_y = width // 2, height // 2
        mask_size = min(width, height) // 4
        mask_array[center_y-mask_size:center_y+mask_size, center_x-mask_size:center_x+mask_size] = 255
        
        mask_img = Image.fromarray(mask_array, mode='L')
        mask_png = self._image_to_base64_png(mask_img)
        
        return PredictionResult(
            masks=[mask_png],
            boxes=[[float(center_x-mask_size), float(center_y-mask_size), float(center_x+mask_size), float(center_y+mask_size)]],
            scores=[0.95],  # Mock confidence score
            num_instances=1
        )
    
    async def predict_pvs(
        self,
        image: Image.Image,
        input_points: Optional[List[List[int]]] = None,
        input_labels: Optional[List[int]] = None,
        input_boxes: Optional[List[List[float]]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """Predict using PVS mode (point + box prompts)"""
        if self._pvs_model and self._pvs_processor:
            # Use real SAM3
            try:
                # Prepare inputs
                inputs = {}
                
                if input_points and input_labels:
                    # Convert to format expected by SAM3 PVS
                    # Format: [[[[x, y]]]] for single object with multiple points
                    inputs["input_points"] = [[input_points]]
                    inputs["input_labels"] = [[input_labels]]
                
                if input_boxes:
                    # Convert to format expected by SAM3 PVS
                    # Format: [[[x1, y1, x2, y2]]]
                    inputs["input_boxes"] = [input_boxes]
                
                # Process image
                processed_inputs = self._pvs_processor(
                    images=image,
                    return_tensors="pt",
                    **inputs
                ).to(self._device)
                
                # Run inference
                with torch.no_grad():
                    outputs = self._pvs_model(**processed_inputs, multimask_output=False)
                
                # Post-process masks
                masks = self._pvs_processor.post_process_masks(
                    outputs.pred_masks.cpu(),
                    processed_inputs["original_sizes"]
                )[0]
                
                # Convert masks to base64 PNGs and extract boxes
                masks_png = []
                boxes = []
                scores = []
                
                for i, mask in enumerate(masks):
                    # Convert mask to binary image
                    mask_np = mask.cpu().numpy().astype(np.uint8) * 255
                    mask_img = Image.fromarray(mask_np, mode='L')
                    masks_png.append(self._image_to_base64_png(mask_img))
                    
                    # Extract bounding box from mask
                    if mask_np.sum() > 0:
                        y_indices, x_indices = np.where(mask_np > 0)
                        x_min, x_max = x_indices.min(), x_indices.max()
                        y_min, y_max = y_indices.min(), y_indices.max()
                        boxes.append([float(x_min), float(y_min), float(x_max), float(y_max)])
                    else:
                        boxes.append([0.0, 0.0, 0.0, 0.0])
                    
                    # For PVS, we don't have confidence scores, so use 1.0
                    scores.append(1.0)
                
                return PredictionResult(
                    masks=masks_png,
                    boxes=boxes,
                    scores=scores,
                    num_instances=len(masks_png)
                )
            except Exception as e:
                _LOGGER.error(f"SAM3 PVS prediction failed: {e}")
                # Fall back to mock
                return await self._mock_predict_pvs(image, input_points, input_labels, input_boxes, threshold, mask_threshold)
        else:
            # Use mock implementation
            return await self._mock_predict_pvs(image, input_points, input_labels, input_boxes, threshold, mask_threshold)
    
    async def _mock_predict_pvs(
        self,
        image: Image.Image,
        input_points: Optional[List[List[int]]] = None,
        input_labels: Optional[List[int]] = None,
        input_boxes: Optional[List[List[float]]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """Mock PVS prediction"""
        _LOGGER.warning("Using mock PVS prediction - real SAM3 not available")
        
        # Create a simple mock mask around the first point
        width, height = image.size
        mask_array = np.zeros((height, width), dtype=np.uint8)
        
        if input_points and len(input_points) > 0:
            # Create mask around first positive point
            for i, (point, label) in enumerate(zip(input_points, input_labels or [])):
                if label == 1:  # Positive point
                    x, y = point
                    mask_size = 50
                    mask_array[max(0, y-mask_size):min(height, y+mask_size), 
                              max(0, x-mask_size):min(width, x+mask_size)] = 255
                    break
        
        mask_img = Image.fromarray(mask_array, mode='L')
        mask_png = self._image_to_base64_png(mask_img)
        
        return PredictionResult(
            masks=[mask_png],
            boxes=[[0.0, 0.0, float(width), float(height)]],
            scores=[0.90],  # Mock confidence score
            num_instances=1
        )
    
    def _image_to_base64_png(self, image: Image.Image) -> str:
        """Convert PIL Image to base64-encoded PNG string"""
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        image_bytes = buffer.getvalue()
        return base64.b64encode(image_bytes).decode('utf-8')
    
    async def cleanup(self) -> None:
        """Cleanup resources"""
        if self._pcs_model:
            del self._pcs_model
        if self._pvs_model:
            del self._pvs_model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        _LOGGER.info("SAM3 backend cleaned up")
