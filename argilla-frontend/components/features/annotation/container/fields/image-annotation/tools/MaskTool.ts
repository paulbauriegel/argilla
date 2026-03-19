import { BaseAnnotationTool } from "./BaseAnnotationTool";
import { DrawingState, AnchorPointConfig } from "./IAnnotationTool";
import {
  ToolInteraction,
  InteractionContext,
} from "./IToolInteraction";
import { MaskInteraction } from "./MaskInteraction";
import { ImageAnnotationAnswer } from "~/v1/domain/entities/IAnswer";

interface MaskDrawingState extends DrawingState {
  kind: "draw-mask";
  color: string;
}

/**
 * Tool for drawing binary masks with brush/eraser
 */
export class MaskTool extends BaseAnnotationTool {
  readonly shapeType = "mask";
  private brushSize: number = 10;
  private brushMode: "brush" | "eraser" = "brush";

  createInteraction(
    context: InteractionContext,
    startPos: { x: number; y: number },
    color: string,
    isHole: boolean,
    parentIndex?: number,
    selectedLabel?: { value: string; color: string }
  ): ToolInteraction {
    if (!context.imageNode) {
      throw new Error("Image node is required for mask tool");
    }

    const image = context.imageNode.image() as HTMLImageElement;
    if (!image) {
      throw new Error("Image element is required for mask tool");
    }

    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;

    return new MaskInteraction(
      context,
      selectedLabel,
      imageWidth,
      imageHeight,
      this.brushSize,
      this.brushMode,
      color
    );
  }

  startDrawing(
    pos: { x: number; y: number },
    color: string,
    isHole: boolean,
    parentIndex?: number
  ): MaskDrawingState {
    return {
      kind: "draw-mask",
      color,
    };
  }

  updateDrawing(state: DrawingState, pos: { x: number; y: number }): void {
    // Handled by interaction
  }

  completeDrawing(
    state: DrawingState,
    _annotations: ImageAnnotationAnswer[],
    selectedLabel: { value: string; color: string } | undefined
  ): ImageAnnotationAnswer | null {
    // Handled by interaction
    return null;
  }

  cancelDrawing(state: DrawingState): void {
    // Handled by interaction
  }

  cleanupDrawing(state: DrawingState): void {
    // Handled by interaction
  }

  renderAnchorPoints(
    annotation: ImageAnnotationAnswer,
    annotationIndex: number,
    color: string,
    config: AnchorPointConfig
  ): void {
    if (annotation.shape_type !== "mask") return;

    // For masks, show bounding box corners as anchor points
    const canvasPoints = this.context.getCanvasCoordinates(
      annotation.points,
      this.context.imageNode
    );

    if (canvasPoints.length !== 2) return;

    const [p1, p2] = canvasPoints;
    const corners = [
      [p1[0], p1[1]], // top-left
      [p2[0], p1[1]], // top-right
      [p2[0], p2[1]], // bottom-right
      [p1[0], p2[1]], // bottom-left
    ];

    corners.forEach((corner, idx) => {
      this.createAnchorPoint(corner[0], corner[1], color, {
        ...config,
        pointIndex: idx,
      });
    });
  }

  updateAnnotationFromDrag(
    annotation: ImageAnnotationAnswer,
    pointIndex: number,
    newPos: { x: number; y: number },
    holeIndex: number | null
  ): void {
    if (annotation.shape_type !== "mask" || !this.context.imageNode) return;

    // Convert to image coordinates
    const imageCoords = this.context.getImageCoordinates(
      [[newPos.x, newPos.y]],
      this.context.imageNode
    );
    if (imageCoords.length === 0) return;

    const [newX, newY] = imageCoords[0];

    // Update bounding box based on which corner was dragged
    const [p1, p2] = annotation.points;

    switch (pointIndex) {
      case 0: // top-left
        annotation.points = [[newX, newY], p2];
        break;
      case 1: // top-right
        annotation.points = [[p1[0], newY], [newX, p2[1]]];
        break;
      case 2: // bottom-right
        annotation.points = [p1, [newX, newY]];
        break;
      case 3: // bottom-left
        annotation.points = [[newX, p1[1]], [p2[0], newY]];
        break;
    }
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.max(5, Math.min(50, size));
  }

  getBrushSize(): number {
    return this.brushSize;
  }

  setBrushMode(mode: "brush" | "eraser"): void {
    this.brushMode = mode;
  }

  getBrushMode(): "brush" | "eraser" {
    return this.brushMode;
  }
}
