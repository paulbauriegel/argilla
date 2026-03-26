import Konva from "konva";
import {
  ToolInteraction,
  InteractionContext,
  InteractionResult,
} from "./IToolInteraction";
import { ImageAnnotationAnswer, MaskData } from "~/v1/domain/entities/IAnswer";
import { createMaskDataFromCanvas, calculateMaskBoundingBox, decodeMaskRLEToCanvas } from "../utils/maskStorage";

/**
 * Interaction implementation for mask drawing with brush/eraser.
 *
 * Strategy: maintain an off-screen canvas whose pixel dimensions match the
 * *original* image, but **position and scale the Konva.Image preview** so it
 * sits exactly on top of the displayed image.  Incoming pointer positions
 * are in *stage / canvas* coordinates; we convert them to image-pixel
 * coordinates before painting on the off-screen canvas.
 */
export class MaskInteraction implements ToolInteraction {
  readonly kind = "drawing" as const;
  readonly toolType = "mask";
  readonly isHole: boolean = false;
  readonly color: string;

  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private previewImage: Konva.Image | null = null;
  private lastPos: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;

  // Cached image node geometry so we can map stage→image coords locally
  private imgX: number;
  private imgY: number;
  private imgDisplayW: number;
  private imgDisplayH: number;
  private imgNaturalW: number;
  private imgNaturalH: number;

  constructor(
    private context: InteractionContext,
    private selectedLabel: { value: string; color: string } | undefined,
    private imageWidth: number,
    private imageHeight: number,
    private brushSize: number,
    private brushMode: "brush" | "eraser",
    color: string
  ) {
    this.color = color;

    // Cache image-node geometry once
    const node = context.imageNode!;
    this.imgX = node.x();
    this.imgY = node.y();
    this.imgDisplayW = node.width();
    this.imgDisplayH = node.height();
    this.imgNaturalW = imageWidth;
    this.imgNaturalH = imageHeight;

    // Off-screen mask canvas at full image resolution
    this.maskCanvas = document.createElement("canvas");
    this.maskCanvas.width = imageWidth;
    this.maskCanvas.height = imageHeight;

    const ctx = this.maskCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.maskCtx = ctx;

    this.initializePreview();
  }

  /* ------------------------------------------------------------------ */
  /*  Preview                                                           */
  /* ------------------------------------------------------------------ */

  private initializePreview(): void {
    // Place Konva.Image right on top of the displayed image
    this.previewImage = new Konva.Image({
      image: this.maskCanvas,
      x: this.imgX,
      y: this.imgY,
      width: this.imgDisplayW,
      height: this.imgDisplayH,
      opacity: 0.5,
      listening: false,
    });
    this.context.annotationLayer?.add(this.previewImage);
    this.context.annotationLayer?.batchDraw();
  }

  private updatePreview(): void {
    if (this.previewImage) {
      this.previewImage.image(this.maskCanvas);
      this.previewImage.getLayer()?.batchDraw();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Coordinate helpers                                                */
  /* ------------------------------------------------------------------ */

  /** Convert a stage-coordinate point to image-pixel coordinates. */
  private stageToImage(sx: number, sy: number): [number, number] {
    const ix = ((sx - this.imgX) / this.imgDisplayW) * this.imgNaturalW;
    const iy = ((sy - this.imgY) / this.imgDisplayH) * this.imgNaturalH;
    return [ix, iy];
  }

  /** Brush size in image-pixel space (accounts for display scaling). */
  private get imgBrushSize(): number {
    return (this.brushSize / this.imgDisplayW) * this.imgNaturalW;
  }

  /* ------------------------------------------------------------------ */
  /*  Drawing                                                           */
  /* ------------------------------------------------------------------ */

  private drawBrushStroke(x: number, y: number): void {
    const [imgX, imgY] = this.stageToImage(x, y);
    const r = this.imgBrushSize / 2;

    // Paint with the label color so the preview looks correct.
    // The RLE encoder only reads the alpha channel, so color doesn't
    // affect the stored binary mask.
    const paintColor = this.color;

    this.maskCtx.globalCompositeOperation =
      this.brushMode === "brush" ? "source-over" : "destination-out";

    // Draw a circle at the current position
    this.maskCtx.fillStyle = paintColor;
    this.maskCtx.beginPath();
    this.maskCtx.arc(imgX, imgY, r, 0, Math.PI * 2);
    this.maskCtx.fill();

    // Interpolate from last position for smooth strokes
    if (this.lastPos) {
      const [lastImgX, lastImgY] = this.stageToImage(
        this.lastPos.x,
        this.lastPos.y
      );
      this.maskCtx.lineWidth = this.imgBrushSize;
      this.maskCtx.lineCap = "round";
      this.maskCtx.lineJoin = "round";
      this.maskCtx.strokeStyle = paintColor;
      this.maskCtx.beginPath();
      this.maskCtx.moveTo(lastImgX, lastImgY);
      this.maskCtx.lineTo(imgX, imgY);
      this.maskCtx.stroke();
    }

    this.updatePreview();
  }

  /* ------------------------------------------------------------------ */
  /*  Public setters (called by watchers in the view-model)             */
  /* ------------------------------------------------------------------ */

  setBrushSize(size: number): void {
    this.brushSize = size;
  }

  setBrushMode(mode: "brush" | "eraser"): void {
    this.brushMode = mode;
  }

  /**
   * Load existing mask data onto the off-screen canvas so the user can
   * continue drawing/erasing on a previously saved mask.
   * Supports both "rle" and "png_base64" formats.
   */
  loadMaskData(maskData: MaskData): void {
    // Parse the hex color to RGB for tinting
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(this.color);
    const rgb = result
      ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
      : undefined;

    if (maskData.format === "rle") {
      const decoded = decodeMaskRLEToCanvas(maskData, rgb);
      this.maskCtx.drawImage(decoded, 0, 0);
      this.updatePreview();
    } else if (maskData.format === "png_base64") {
      this.loadPngBase64Mask(maskData.data, rgb);
    }
  }

  /**
   * Load a base64-encoded PNG mask onto the off-screen canvas.
   * The PNG is expected to be a grayscale/alpha mask from the AI backend.
   */
  private loadPngBase64Mask(
    base64Data: string,
    tint?: { r: number; g: number; b: number }
  ): void {
    const img = new Image();
    img.onload = () => {
      // Draw the PNG onto a temporary canvas to read pixel data
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = this.imgNaturalW;
      tmpCanvas.height = this.imgNaturalH;
      const tmpCtx = tmpCanvas.getContext("2d");
      if (!tmpCtx) return;

      tmpCtx.drawImage(img, 0, 0, this.imgNaturalW, this.imgNaturalH);

      // Read pixel data – the backend mask is a grayscale PNG where
      // white (255) = mask, black (0) = background. We tint it with
      // the label color and use the luminance as alpha.
      const srcData = tmpCtx.getImageData(0, 0, this.imgNaturalW, this.imgNaturalH);
      const dstData = this.maskCtx.createImageData(this.imgNaturalW, this.imgNaturalH);

      const r = tint?.r ?? 255;
      const g = tint?.g ?? 255;
      const b = tint?.b ?? 255;

      for (let i = 0; i < srcData.data.length; i += 4) {
        // Use the max of RGB channels (or alpha if present) as mask value
        const maskVal = Math.max(
          srcData.data[i],
          srcData.data[i + 1],
          srcData.data[i + 2]
        );
        dstData.data[i] = r;
        dstData.data[i + 1] = g;
        dstData.data[i + 2] = b;
        dstData.data[i + 3] = maskVal;
      }

      this.maskCtx.putImageData(dstData, 0, 0);
      this.updatePreview();
    };
    img.src = `data:image/png;base64,${base64Data}`;
  }

  /* ------------------------------------------------------------------ */
  /*  ToolInteraction event handlers                                    */
  /* ------------------------------------------------------------------ */

  onPointerDown(pos: { x: number; y: number }): InteractionResult {
    this.isDrawing = true;
    this.lastPos = null; // no interpolation for first dot
    this.drawBrushStroke(pos.x, pos.y);
    this.lastPos = pos;
    return { shouldContinue: true };
  }

  onPointerMove(pos: { x: number; y: number }): void {
    if (this.isDrawing) {
      this.drawBrushStroke(pos.x, pos.y);
      this.lastPos = pos;
    }
  }

  onPointerUp(_pos: { x: number; y: number }): InteractionResult {
    this.isDrawing = false;
    this.lastPos = null;
    return { shouldContinue: true };
  }

  onKeyDown(e: KeyboardEvent): InteractionResult {
    if (e.key === "Enter") {
      return { shouldComplete: true };
    } else if (e.key === "Escape") {
      return { shouldCancel: true };
    } else if (e.key === "b" || e.key === "B") {
      this.setBrushMode("brush");
    } else if (e.key === "e" || e.key === "E") {
      this.setBrushMode("eraser");
    } else if (e.key === "[") {
      this.setBrushSize(Math.max(5, this.brushSize - 5));
    } else if (e.key === "]") {
      this.setBrushSize(Math.min(50, this.brushSize + 5));
    }
    return { shouldContinue: true };
  }

  /* ------------------------------------------------------------------ */
  /*  Lifecycle                                                         */
  /* ------------------------------------------------------------------ */

  complete(): ImageAnnotationAnswer | null {
    if (!this.selectedLabel) return null;

    const boundingBox = calculateMaskBoundingBox(this.maskCanvas);

    // Empty mask — nothing painted
    if (
      boundingBox[0][0] === boundingBox[1][0] &&
      boundingBox[0][1] === boundingBox[1][1]
    ) {
      return null;
    }

    const maskData = createMaskDataFromCanvas(this.maskCanvas, "rle");

    return {
      label: this.selectedLabel.value,
      points: boundingBox,
      shape_type: "mask",
      mask_data: maskData,
      flags: {},
    };
  }

  cancel(): void {
    this.cleanup();
  }

  cleanup(): void {
    if (this.previewImage) {
      this.previewImage.destroy();
      this.previewImage = null;
    }
    this.context.annotationLayer?.batchDraw();
  }
}
