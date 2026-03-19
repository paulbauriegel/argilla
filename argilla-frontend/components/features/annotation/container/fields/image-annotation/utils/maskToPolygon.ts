import { MaskData } from "~/v1/domain/entities/IAnswer";
import { decodeMaskRLE } from "./maskStorage";

/**
 * Convert a mask annotation (RLE) into polygon points by extracting boundary
 * pixels, sorting them angularly around the centroid, and simplifying.
 *
 * Returns an array of [x, y] points in image-pixel coordinates,
 * or null if the mask is empty / conversion fails.
 */
export function maskToPolygonPoints(
  maskData: MaskData
): number[][] | null {
  if (maskData.format !== "rle") return null;

  const { width, height } = maskData;
  const mask = decodeMaskRLE(maskData.data, width, height);

  // Collect boundary pixels: filled pixels with at least one empty 4-neighbour
  const boundary: number[][] = [];
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      // Check 4-connected neighbours
      const top = y > 0 ? mask[(y - 1) * width + x] : 0;
      const bot = y < height - 1 ? mask[(y + 1) * width + x] : 0;
      const lft = x > 0 ? mask[y * width + (x - 1)] : 0;
      const rgt = x < width - 1 ? mask[y * width + (x + 1)] : 0;
      if (top === 0 || bot === 0 || lft === 0 || rgt === 0) {
        boundary.push([x, y]);
        sumX += x;
        sumY += y;
      }
    }
  }

  if (boundary.length < 3) return null;

  // Sort boundary pixels by angle from centroid
  const cx = sumX / boundary.length;
  const cy = sumY / boundary.length;

  boundary.sort((a, b) => {
    const angleA = Math.atan2(a[1] - cy, a[0] - cx);
    const angleB = Math.atan2(b[1] - cy, b[0] - cx);
    return angleA - angleB;
  });

  // Simplify with Douglas-Peucker
  const epsilon = Math.max(width, height) * 0.005;
  const simplified = douglasPeucker(boundary, epsilon);

  if (simplified.length < 3) return null;

  return simplified;
}

/**
 * Douglas-Peucker line simplification.
 */
function douglasPeucker(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line (first -> last)
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function perpendicularDistance(
  point: number[],
  lineStart: number[],
  lineEnd: number[]
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // lineStart and lineEnd are the same point
    const ex = point[0] - lineStart[0];
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }

  const num = Math.abs(
    dy * point[0] - dx * point[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]
  );
  return num / Math.sqrt(lenSq);
}
