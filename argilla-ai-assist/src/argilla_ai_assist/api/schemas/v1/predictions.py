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

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class SegmentationRequest(BaseModel):
    """Request for image segmentation"""
    
    image: str = Field(..., description="Base64-encoded image data")
    text: Optional[str] = Field(None, description="Text prompt for PCS mode")
    input_points: Optional[List[List[int]]] = Field(
        None, 
        description="List of points in [[x, y], ...] format for PVS mode"
    )
    input_labels: Optional[List[int]] = Field(
        None,
        description="List of point labels (1=positive, 0=negative) for PVS mode"
    )
    input_boxes: Optional[List[List[float]]] = Field(
        None,
        description="List of boxes in [[x1, y1, x2, y2], ...] format"
    )
    input_boxes_labels: Optional[List[int]] = Field(
        None,
        description="List of box labels (1=positive, 0=negative) for PCS mode"
    )
    threshold: Optional[float] = Field(
        0.5,
        description="Confidence threshold for instance segmentation"
    )
    mask_threshold: Optional[float] = Field(
        0.5,
        description="Mask threshold for binary mask generation"
    )
    
    @field_validator('input_labels')
    @classmethod 
    def validate_input_labels(cls, v, info):
        """Validate that input_labels length matches input_points length"""
        if v is not None and info.data and 'input_points' in info.data and info.data['input_points'] is not None:
            if len(v) != len(info.data['input_points']):
                raise ValueError("input_labels length must match input_points length")
        return v
    
    @field_validator('input_boxes_labels')
    @classmethod
    def validate_input_boxes_labels(cls, v, info):
        """Validate that input_boxes_labels length matches input_boxes length"""
        if v is not None and info.data and 'input_boxes' in info.data and info.data['input_boxes'] is not None:
            if len(v) != len(info.data['input_boxes']):
                raise ValueError("input_boxes_labels length must match input_boxes length")
        return v
    
    @field_validator('threshold', 'mask_threshold')
    @classmethod
    def validate_thresholds(cls, v):
        """Validate threshold values are between 0 and 1"""
        if v is not None and (v < 0.0 or v > 1.0):
            raise ValueError("Threshold values must be between 0.0 and 1.0")
        return v


class SegmentationResponse(BaseModel):
    """Response from image segmentation"""
    
    masks: List[str] = Field(..., description="List of base64-encoded PNG masks")
    boxes: List[List[float]] = Field(
        ..., 
        description="List of bounding boxes in [[x1, y1, x2, y2], ...] format"
    )
    scores: List[float] = Field(..., description="List of confidence scores")
    num_instances: int = Field(..., description="Number of detected instances")
    
    @field_validator('num_instances')
    @classmethod
    def validate_num_instances(cls, v, info):
        """Validate that num_instances matches the length of other fields"""
        if info.data:
            if 'masks' in info.data and len(info.data['masks']) != v:
                raise ValueError("num_instances must match length of masks")
            if 'boxes' in info.data and len(info.data['boxes']) != v:
                raise ValueError("num_instances must match length of boxes")
            if 'scores' in info.data and len(info.data['scores']) != v:
                raise ValueError("num_instances must match length of scores")
        return v
