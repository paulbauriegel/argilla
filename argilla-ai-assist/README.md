# argilla-ai-assist

AI prediction service for Argilla using SAM3 model for image segmentation.

## Overview

`argilla-ai-assist` is a FastAPI service that provides AI-powered image segmentation using the Facebook SAM3 model. It follows the same architectural patterns as `argilla-server` and integrates with the same authentication system.

## Features

- **Promptable Concept Segmentation (PCS)**: Text and/or box prompts
- **Promptable Visual Segmentation (PVS)**: Point and box prompts
- **Shared authentication** with argilla-server (JWT + API key)
- **Base64 PNG mask outputs** for maximum portability
- **GPU acceleration** support

## GPU Requirements

SAM3 is a large model requiring significant GPU resources:

- **Minimum**: NVIDIA GPU with 8GB VRAM
- **Recommended**: NVIDIA GPU with 16GB+ VRAM
- **CPU fallback**: Available but significantly slower

The service will automatically detect and use CUDA if available.

## Installation

```bash
# Clone and install with PDM
git clone <repository>
cd argilla-ai-assist
pdm install
```

## Configuration

Set environment variables (prefix `ARGILLA_AI_ASSIST_`):

```bash
# Hugging Face authentication (required for SAM3)
HF_TOKEN=your-huggingface-token-here
HF_HOME=~/.cache/huggingface

# Model settings
ARGILLA_AI_ASSIST_MODEL_ID=facebook/sam3
ARGILLA_AI_ASSIST_DEVICE=auto  # cpu, cuda, auto

# Server settings
ARGILLA_AI_ASSIST_HOST=0.0.0.0
ARGILLA_AI_ASSIST_PORT=6950
ARGILLA_AI_ASSIST_CORS_ORIGINS=["*"]

# Auth settings (must match argilla-server)
ARGILLA_AI_ASSIST_SECRET_KEY=<same-as-argilla-server>
ARGILLA_AI_ASSIST_ALGORITHM=HS256
ARGILLA_AI_ASSIST_DATABASE_URL=<same-as-argilla-server>

# Model thresholds
ARGILLA_AI_ASSIST_THRESHOLD=0.5
ARGILLA_AI_ASSIST_MASK_THRESHOLD=0.5
```

### Hugging Face Setup for SAM3

SAM3 is a gated model requiring authentication:

1. **Get a Hugging Face token**: Visit https://huggingface.co/settings/tokens
2. **Accept SAM3 terms**: Go to https://huggingface.co/facebook/sam3 and accept the terms
3. **Set the token**: Add `HF_TOKEN=your-token-here` to your environment or `.env.dev` file

The service will automatically authenticate and download SAM3 when available. If authentication fails, it will fall back to a mock implementation for demonstration.

## Usage

Start the server:

```bash
pdm run server
```

### API Endpoint

**POST** `/api/v1/predictions/segment`

Request body:
```json
{
  "image": "base64-encoded-image-data",
  "text": "optional text prompt for PCS mode",
  "input_points": [[x, y], ...],  // Optional for PVS mode
  "input_labels": [1, 0, ...],     // Optional: 1=positive, 0=negative
  "input_boxes": [[x1, y1, x2, y2], ...],  // Optional
  "input_boxes_labels": [1, 0, ...],       // Optional: 1=positive, 0=negative
  "threshold": 0.5,
  "mask_threshold": 0.5
}
```

Response:
```json
{
  "masks": ["base64-encoded-png-1", "base64-encoded-png-2", ...],
  "boxes": [[x1, y1, x2, y2], ...],
  "scores": [0.95, 0.87, ...],
  "num_instances": 2
}
```

### Mode Selection

The service automatically selects the appropriate SAM3 mode:

- **PCS mode** (text/box prompts): When `text` or `input_boxes_labels` are provided
- **PVS mode** (point prompts): When `input_points` are provided

## Authentication

The service shares authentication with argilla-server:

- **JWT tokens**: Use the same tokens as argilla-server
- **API keys**: Use argilla-server API keys
- **Database**: Connects to the same user database

Include the authentication header in requests:

```bash
# JWT token
Authorization: Bearer <jwt-token>

# API key
X-API-Key: <api-key>
```

## Development

```bash
# Install dev dependencies
pdm install -d

# Run tests
pdm run test

# Start development server
pdm run server
```

## License

Apache License 2.0
