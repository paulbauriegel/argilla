import { contours } from "d3-contour";
import { MaskData, ImageAnnotationHole } from "~/v1/domain/entities/IAnswer";
import { decodeMaskRLE } from "./maskStorage";

export type MaskToPolygonResult = {
  points: number[][];
  holes?: ImageAnnotationHole[];
};

/**
 * Convert a mask annotation (RLE) into polygon points using marching squares
 * contour extraction (d3-contour). Properly handles concave shapes and holes.
 *
 * Returns the outer polygon points and any holes, or null if the mask is
 * empty / conversion fails.
 */
export function maskToPolygonPoints(
  maskData: MaskData
): MaskToPolygonResult | null {
  if (maskData.format !== "rle") return null;

  const { width, height } = maskData;
  const mask = decodeMaskRLE(maskData.data, width, height);

  // Convert to 0/1 values for d3-contour (it expects values[i + j*n])
  const values = new Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      values[i + j * width] = mask[j * width + i] > 0 ? 1 : 0;
    }
  }

  // Extract contours at threshold 1 using marching squares
  const contourGenerator = contours()
    .size([width, height])
    .smooth(false)
    .thresholds([1]);

  const contourResults = contourGenerator(values);
  if (!contourResults || contourResults.length === 0) return null;

  // The result for threshold=1 is a single GeoJSON MultiPolygon
  const geometry = contourResults[0];
  if (
    !geometry ||
    !geometry.coordinates ||
    geometry.coordinates.length === 0
  ) {
    return null;
  }

  // Each element in coordinates is a polygon: [outerRing, ...holeRings]
  // Pick the polygon with the largest outer ring (by absolute area)
  let bestPolygon: number[][][] | null = null;
  let bestArea = 0;

  for (const polygon of geometry.coordinates) {
    if (!polygon || polygon.length === 0) continue;
    const outerRing = polygon[0];
    const area = Math.abs(ringArea(outerRing));
    if (area > bestArea) {
      bestArea = area;
      bestPolygon = polygon;
    }
  }

  if (!bestPolygon || bestPolygon.length === 0) return null;

  const epsilon = Math.max(width, height) * 0.005;

  // Process the outer ring
  const outerRing = bestPolygon[0];
  const outerPoints = simplifyRing(outerRing, epsilon);
  if (outerPoints.length < 3) return null;

  // Process hole rings
  const holes: ImageAnnotationHole[] = [];
  for (let i = 1; i < bestPolygon.length; i++) {
    const holeRing = bestPolygon[i];
    const holePoints = simplifyRing(holeRing, epsilon);
    if (holePoints.length >= 3) {
      holes.push({
        points: holePoints,
        shape_type: "polygon",
      });
    }
  }

  // Also collect holes from other (smaller) polygons in the MultiPolygon —
  // these are disjoint outer regions we treat as additional contours.
  // For now we only return the largest polygon + its holes, which covers
  // the vast majority of real-world mask shapes.

  const result: MaskToPolygonResult = { points: outerPoints };
  if (holes.length > 0) {
    result.holes = holes;
  }

  return result;
}

/**
 * Convert a GeoJSON ring (array of [x,y] with closing duplicate) into
 * simplified [x,y] points suitable for annotation.
 */
function simplifyRing(ring: number[][], epsilon: number): number[][] {
  // GeoJSON rings are closed (first === last), remove the closing point
  let points = ring.slice(0, -1);
  if (points.length < 3) return points;

  points = douglasPeucker(points, epsilon);
  return points;
}

/**
 * Signed area of a ring (Shoelace formula).
 * Positive for CCW, negative for CW.
 */
function ringArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
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
