/**
 * Service for communicating with the argilla-ai-assist backend
 * (SAM3 segmentation endpoint).
 */

export interface SegmentationResult {
  masks: string[]; // base64-encoded PNG masks
  boxes: number[][]; // [[x1, y1, x2, y2], ...]
  scores: number[]; // confidence scores
  num_instances: number;
}

export interface SegmentationOptions {
  text?: string;
  inputPoints?: number[][];
  inputLabels?: number[];
  inputBoxes?: number[][];
  inputBoxesLabels?: number[];
  threshold?: number;
  maskThreshold?: number;
}

/**
 * Convert an image URL to a base64 string.
 * If the content is already base64 (data URL), extract the base64 part.
 */
async function imageToBase64(content: string): Promise<string> {
  // Already a data URL
  if (content.startsWith("data:")) {
    return content.split(",")[1];
  }

  // Fetch the image and convert to base64 via canvas
  const response = await fetch(content);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Get the AI-Assist base URL from Nuxt runtime config or fall back to default.
 */
function getAiAssistBaseUrl(): string {
  try {
    // @ts-ignore – Nuxt 2 runtime config
    const config = window?.__NUXT__?.config?.publicRuntimeConfig;
    if (config?.aiAssistBaseUrl) {
      return config.aiAssistBaseUrl;
    }
  } catch {
    // ignore
  }
  return process.env.AI_ASSIST_BASE_URL || "http://localhost:6950";
}

/**
 * Get the current user's auth token from Nuxt auth module.
 */
function getAuthToken(): string | null {
  try {
    // @ts-ignore – Nuxt 2 auth token stored in localStorage
    const token = localStorage.getItem("auth._token.local");
    if (token && token !== "false") {
      // Remove "Bearer " prefix if present – we'll add it ourselves
      return token.replace(/^Bearer\s+/i, "");
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Request segmentation from the AI-Assist backend.
 */
export async function requestSegmentation(
  imageContent: string,
  options: SegmentationOptions
): Promise<SegmentationResult> {
  const baseUrl = getAiAssistBaseUrl();
  const token = getAuthToken();

  if (!token) {
    throw new Error("Not authenticated – cannot call AI Assist service");
  }

  const imageBase64 = await imageToBase64(imageContent);

  const body: Record<string, unknown> = {
    image: imageBase64,
  };

  if (options.text) body.text = options.text;
  if (options.inputPoints) body.input_points = options.inputPoints;
  if (options.inputLabels) body.input_labels = options.inputLabels;
  if (options.inputBoxes) body.input_boxes = options.inputBoxes;
  if (options.inputBoxesLabels)
    body.input_boxes_labels = options.inputBoxesLabels;
  if (options.threshold !== undefined) body.threshold = options.threshold;
  if (options.maskThreshold !== undefined)
    body.mask_threshold = options.maskThreshold;

  const response = await fetch(`${baseUrl}/api/v1/predictions/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `AI Assist segmentation failed (${response.status}): ${errorText}`
    );
  }

  return (await response.json()) as SegmentationResult;
}
