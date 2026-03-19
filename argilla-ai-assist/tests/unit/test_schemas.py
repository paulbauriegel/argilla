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
from pydantic import ValidationError

from argilla_ai_assist.api.schemas.v1.predictions import SegmentationRequest, SegmentationResponse


def test_segmentation_request_valid_text_prompt():
    """Test valid segmentation request with text prompt"""
    # Create a simple test image (1x1 pixel)
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    request = SegmentationRequest(
        image=test_image,
        text="cat"
    )
    
    assert request.text == "cat"
    assert request.threshold == 0.5
    assert request.mask_threshold == 0.5


def test_segmentation_request_valid_point_prompt():
    """Test valid segmentation request with point prompts"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    request = SegmentationRequest(
        image=test_image,
        input_points=[[100, 100], [200, 200]],
        input_labels=[1, 1]
    )
    
    assert len(request.input_points) == 2
    assert len(request.input_labels) == 2
    assert request.input_labels == [1, 1]


def test_segmentation_request_invalid_point_labels_mismatch():
    """Test validation error when input_labels length doesn't match input_points"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    with pytest.raises(ValidationError) as exc_info:
        SegmentationRequest(
            image=test_image,
            input_points=[[100, 100], [200, 200]],
            input_labels=[1]  # Length mismatch
        )
    
    assert "input_labels length must match input_points length" in str(exc_info.value)


def test_segmentation_request_invalid_box_labels_mismatch():
    """Test validation error when input_boxes_labels length doesn't match input_boxes"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    with pytest.raises(ValidationError) as exc_info:
        SegmentationRequest(
            image=test_image,
            input_boxes=[[0, 0, 100, 100], [50, 50, 150, 150]],
            input_boxes_labels=[1]  # Length mismatch
        )
    
    assert "input_boxes_labels length must match input_boxes length" in str(exc_info.value)


def test_segmentation_request_invalid_threshold():
    """Test validation error when threshold is out of range"""
    test_image = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    with pytest.raises(ValidationError) as exc_info:
        SegmentationRequest(
            image=test_image,
            text="cat",
            threshold=1.5  # Invalid threshold
        )
    
    assert "Threshold values must be between 0.0 and 1.0" in str(exc_info.value)


def test_segmentation_response_valid():
    """Test valid segmentation response"""
    test_mask = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    response = SegmentationResponse(
        masks=[test_mask, test_mask],
        boxes=[[0.0, 0.0, 100.0, 100.0], [50.0, 50.0, 150.0, 150.0]],
        scores=[0.95, 0.87],
        num_instances=2
    )
    
    assert len(response.masks) == 2
    assert len(response.boxes) == 2
    assert len(response.scores) == 2
    assert response.num_instances == 2


def test_segmentation_response_invalid_num_instances():
    """Test validation error when num_instances doesn't match arrays"""
    test_mask = base64.b64encode(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82').decode()
    
    with pytest.raises(ValidationError) as exc_info:
        SegmentationResponse(
            masks=[test_mask],  # Length 1
            boxes=[[0.0, 0.0, 100.0, 100.0], [50.0, 50.0, 150.0, 150.0]],  # Length 2
            scores=[0.95, 0.87],  # Length 2
            num_instances=2  # Mismatch with masks length
        )
    
    assert "num_instances must match length of masks" in str(exc_info.value)
