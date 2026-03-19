import { MaskData } from "~/v1/domain/entities/IAnswer";

/**
 * Run-Length Encoding for binary masks
 * Format: alternating runs of 0s and 1s, starting with 0s
 * Example: [3, 2, 5] means 3 zeros, 2 ones, 5 zeros
 */
export function encodeMaskRLE(maskData: Uint8Array, width: number, height: number): string {
  const runs: number[] = [];
  let currentValue = 0;
  let currentRun = 0;

  for (let i = 0; i < maskData.length; i++) {
    const value = maskData[i] > 0 ? 1 : 0;
    
    if (value === currentValue) {
      currentRun++;
    } else {
      runs.push(currentRun);
      currentValue = value;
      currentRun = 1;
    }
  }
  
  runs.push(currentRun);
  
  return runs.join(',');
}

/**
 * Decode RLE string back to binary mask
 */
export function decodeMaskRLE(rleString: string, width: number, height: number): Uint8Array {
  const runs = rleString.split(',').map(Number);
  const maskData = new Uint8Array(width * height);
  
  let currentValue = 0;
  let position = 0;
  
  for (const run of runs) {
    for (let i = 0; i < run; i++) {
      maskData[position++] = currentValue * 255;
    }
    currentValue = 1 - currentValue;
  }
  
  return maskData;
}

/**
 * Convert canvas to PNG base64
 */
export function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Convert PNG base64 to canvas
 */
export function pngBase64ToCanvas(base64: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

/**
 * Create MaskData from canvas
 */
export function createMaskDataFromCanvas(canvas: HTMLCanvasElement, format: "rle" | "png_base64" = "rle"): MaskData {
  const width = canvas.width;
  const height = canvas.height;
  
  if (format === "rle") {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const maskData = new Uint8Array(width * height);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      maskData[i / 4] = imageData.data[i + 3];
    }
    
    return {
      format: "rle",
      data: encodeMaskRLE(maskData, width, height),
      width,
      height
    };
  } else {
    return {
      format: "png_base64",
      data: canvasToPngBase64(canvas),
      width,
      height
    };
  }
}

/**
 * Decode MaskData to canvas (async — needed for png_base64 format)
 */
export async function decodeMaskDataToCanvas(maskData: MaskData): Promise<HTMLCanvasElement> {
  if (maskData.format === "png_base64") {
    return pngBase64ToCanvas(maskData.data, maskData.width, maskData.height);
  }
  return decodeMaskRLEToCanvas(maskData);
}

/**
 * Synchronously decode an RLE MaskData to a canvas, optionally tinted
 * with a given color.  Falls back to white if no color is provided.
 */
export function decodeMaskRLEToCanvas(
  maskData: MaskData,
  color?: { r: number; g: number; b: number }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = maskData.width;
  canvas.height = maskData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const r = color?.r ?? 255;
  const g = color?.g ?? 255;
  const b = color?.b ?? 255;

  const decodedMask = decodeMaskRLE(maskData.data, maskData.width, maskData.height);
  const imageData = ctx.createImageData(maskData.width, maskData.height);

  for (let i = 0; i < decodedMask.length; i++) {
    const idx = i * 4;
    imageData.data[idx] = r;
    imageData.data[idx + 1] = g;
    imageData.data[idx + 2] = b;
    imageData.data[idx + 3] = decodedMask[i];
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Calculate bounding box of non-zero pixels in mask
 */
export function calculateMaskBoundingBox(canvas: HTMLCanvasElement): number[][] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [[0, 0], [canvas.width, canvas.height]];
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  let hasPixels = false;
  
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      if (imageData.data[idx + 3] > 0) {
        hasPixels = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasPixels) {
    return [[0, 0], [0, 0]];
  }
  
  return [[minX, minY], [maxX, maxY]];
}
