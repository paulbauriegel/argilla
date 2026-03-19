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
Base backend interface for AI prediction services
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional

import numpy as np
from PIL import Image


@dataclass
class PredictionResult:
    """Result of a prediction operation"""
    masks: List[str]  # Base64-encoded PNG strings
    boxes: List[List[float]]  # [[x1, y1, x2, y2], ...] in absolute pixel coordinates
    scores: List[float]  # Confidence scores for each mask
    num_instances: int  # Number of detected instances


class BaseBackend(ABC):
    """Abstract base class for AI prediction backends"""
    
    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the backend (load models, etc.)"""
        pass
    
    @abstractmethod
    async def predict_pcs(
        self,
        image: Image.Image,
        text: Optional[str] = None,
        input_boxes: Optional[List[List[float]]] = None,
        input_boxes_labels: Optional[List[int]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """
        Predict using Promptable Concept Segmentation (PCS) mode
        
        Args:
            image: Input PIL Image
            text: Optional text prompt
            input_boxes: Optional list of boxes in [[x1,y1,x2,y2], ...] format
            input_boxes_labels: Optional list of box labels (1=positive, 0=negative)
            threshold: Confidence threshold
            mask_threshold: Mask threshold for binary mask generation
            
        Returns:
            PredictionResult with masks, boxes, and scores
        """
        pass
    
    @abstractmethod
    async def predict_pvs(
        self,
        image: Image.Image,
        input_points: Optional[List[List[int]]] = None,
        input_labels: Optional[List[int]] = None,
        input_boxes: Optional[List[List[float]]] = None,
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
    ) -> PredictionResult:
        """
        Predict using Promptable Visual Segmentation (PVS) mode
        
        Args:
            image: Input PIL Image
            input_points: Optional list of points in [[x, y], ...] format
            input_labels: Optional list of point labels (1=positive, 0=negative)
            input_boxes: Optional list of boxes in [[x1,y1,x2,y2], ...] format
            threshold: Confidence threshold
            mask_threshold: Mask threshold for binary mask generation
            
        Returns:
            PredictionResult with masks, boxes, and scores
        """
        pass
    
    @abstractmethod
    async def cleanup(self) -> None:
        """Cleanup resources"""
        pass
