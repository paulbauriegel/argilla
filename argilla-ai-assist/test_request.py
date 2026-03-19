#!/usr/bin/env python3
"""
Test script for SAM3 API endpoint
"""
import base64
import json
import requests
from pathlib import Path

# Image path
image_path = Path("/Users/A92940251/Documents/AICC-Next/digibb/data/ab1e31a4-464a-43af-be96-99ca8900fdd9/1BD3CEF2-8964-4A3F-98C0-92DBAA5E55AA/3_rgb.png")

# Read and encode image
with open(image_path, "rb") as f:
    image_data = base64.b64encode(f.read()).decode('utf-8')

# Prepare request payload
payload = {
    "image": image_data,
    "text": "pipe or cable",
    "mode": "pcs",  # Promptable Concept Segmentation
    "threshold": 0.5,
    "mask_threshold": 0.5
}

# Send request
try:
    # Use valid JWT token for argilla user
    headers = {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFyZ2lsbGEiLCJleHAiOjE3NzM5MTg0Mjh9.eWl_LXU7kD7WNESDB82xvQQIHZZ4P2DF9TE4exjKex4",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        "http://127.0.0.1:6950/api/v1/predictions/segment",
        json=payload,
        headers=headers,
        timeout=60
    )
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    
    if response.status_code == 200:
        result = response.json()
        print(f"Success! Found {result.get('num_instances', 0)} instances")
        print(f"Number of masks: {len(result.get('masks', []))}")
        print(f"Boxes: {result.get('boxes', [])}")
        print(f"Scores: {result.get('scores', [])}")
    else:
        print(f"Error: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")
