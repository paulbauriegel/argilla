import { ref, computed, onMounted, watch, onUnmounted } from "vue-demi";
import Konva from "konva";
import { useImageAnnotationSharedState } from "./useImageAnnotationSharedState";
import { initKonvaStage } from "./composables/useKonvaStage";
import { loadImageNode } from "./composables/useImageLoader";
import { useResize } from "./composables/useResize";
import { useKeyboardShortcuts } from "./composables/useKeyboardShortcuts";
import { useContextMenu } from "./composables/useContextMenu";
import { AnnotationRenderer } from "./rendering/AnnotationRenderer";
import { getImageCoordinates, getCanvasCoordinates } from "./utils/coordinates";
import { isPointWithinParent as checkPointWithinParent } from "./utils/geometry";
import { completeHoleCreation } from "./utils/holeCreationUtils";
import { AnnotationToolFactory } from "./tools/AnnotationToolFactory";
import { ToolContext } from "./tools/IAnnotationTool";
import { ToolInteraction, InteractionContext } from "./tools/IToolInteraction";
import { MaskInteraction } from "./tools/MaskInteraction";
import { maskToPolygonPoints } from "./utils/maskToPolygon";
import { Question } from "~/v1/domain/entities/question/Question";
import { ImageAnnotationQuestionAnswer } from "~/v1/domain/entities/question/QuestionAnswer";
import { useNotifications } from "~/v1/infrastructure/services/useNotifications";

/**
 * Simplified mode type - only 3 conceptual states
 * Drawing state is now owned by activeInteraction
 */
type Mode =
  | { kind: "idle" }
  | { kind: "drawing" }
  | { kind: "edit"; annotationIndex: number };

export const useImageAnnotationFieldViewModel = (props: {
  id: string;
  name: string;
  content: string;
  imageAnnotationQuestion: Question;
}) => {
  const { content, imageAnnotationQuestion } = props;
  const answer =
    imageAnnotationQuestion.answer as ImageAnnotationQuestionAnswer;
  const sharedState = useImageAnnotationSharedState(answer);
  const notification = useNotifications();

  // Constants
  const MAX_HOLES_PER_SHAPE = 10;

  // Konva objects (managed by composables)
  let stage: Konva.Stage | null = null;
  let imageLayer: Konva.Layer | null = null;
  let annotationLayer: Konva.Layer | null = null;
  let imageNode: Konva.Image | null = null;
  let originalImageWidth = 0;
  let originalImageHeight = 0;
  let toolFactory: AnnotationToolFactory | null = null;
  let renderer: AnnotationRenderer | null = null;

  const canvasContainer = ref<HTMLDivElement | null>(null);
  const imageLoaded = ref(false);
  const hasError = ref(false);
  const hoveredAnnotation = ref<number | null>(null);
  const draggingPoint = ref<{
    annotationIndex: number;
    pointIndex: number;
    holeIndex: number | null;
  } | null>(null);
  const mode = ref<Mode>({ kind: "idle" });
  const activeInteraction = ref<ToolInteraction | null>(null);

  // Use resize composable to handle canvas resizing
  useResize(
    canvasContainer,
    () => stage,
    () => imageNode,
    () => ({ width: originalImageWidth, height: originalImageHeight }),
    () => annotationLayer,
    {
      debounceMs: 150,
      onResize: () => {
        renderAnnotations();
        if (editMode.value.active && editMode.value.annotationIndex !== null) {
          renderAnchorPoints(editMode.value.annotationIndex);
        }
      },
    }
  );

  const editMode = computed(() => ({
    active: sharedState.editModeActive.value,
    annotationIndex: sharedState.currentAnnotationIndex.value,
  }));

  const selectedTool = computed(() => sharedState.selectedTool.value);

  const annotations = computed(() => answer.values);

  const selectedLabel = computed(() => {
    return answer.options.find((opt) => opt.isSelected);
  });

  const getAnnotationColor = (labelValue: string) =>
    answer.getAnnotationColor(labelValue);

  /**
   * Create base context with shared properties
   */
  const getBaseContext = () => ({
    annotationLayer,
    imageLayer,
    imageNode,
    getAnnotationColor,
    getImageCoordinates: (points: number[][], _imageNode: Konva.Image | null) =>
      getImageCoordinates(points, imageNode),
    getCanvasCoordinates: (
      points: number[][],
      _imageNode: Konva.Image | null
    ) => getCanvasCoordinates(points, imageNode),
    updateAnswer,
    renderAnnotations,
  });

  const getToolContext = (): ToolContext => ({
    ...getBaseContext(),
    renderAnchorPoints,
    getTool: (toolType: string) => toolFactory?.getTool(toolType) || null,
  });

  const initializeToolFactory = () => {
    toolFactory = new AnnotationToolFactory(getToolContext());
  };

  const initializeRenderer = () => {
    renderer = new AnnotationRenderer({
      annotationLayer,
      imageLayer,
      imageNode,
      toolFactory,
      getAnnotationColor,
      onHoverAnnotation: hoverAnnotation,
      onUnhoverAnnotation: unhoverAnnotation,
    });
  };

  /**
   * Create InteractionContext for tool interactions
   */
  const getInteractionContext = (): InteractionContext => getBaseContext();

  /**
   * Handle interaction result from event handlers
   */
  const handleInteractionResult = (result: {
    shouldComplete?: boolean;
    shouldCancel?: boolean;
    shouldContinue?: boolean;
  }) => {
    if (result.shouldComplete) {
      completeInteraction();
    } else if (result.shouldCancel) {
      cancelInteraction();
    }
    // shouldContinue or undefined - interaction continues
  };

  /**
   * Start a new drawing interaction
   */
  const startDrawingInteraction = (pos: { x: number; y: number }) => {
    const tool = toolFactory?.getTool(selectedTool.value);
    if (!tool) return;

    // Determine if we're in hole drawing mode
    const isHole = sharedState.holeDrawingMode.value.active;
    const parentIndex =
      sharedState.holeDrawingMode.value.parentIndex ?? undefined;

    if (isHole && parentIndex !== undefined) {
      // Drawing a hole - check if point is within parent
      if (!isPointWithinParent(pos, parentIndex)) return;

      const color = getAnnotationColor(annotations.value[parentIndex].label);
      activeInteraction.value = tool.createInteraction(
        getInteractionContext(),
        pos,
        color,
        true,
        parentIndex
      );
    } else {
      // Drawing a normal annotation
      if (!selectedLabel.value) {
        notification.notify({
          message: "Please select a label first",
          type: "warning",
        });
        return;
      }

      const color = selectedLabel.value.color || "#cccccc";
      activeInteraction.value = tool.createInteraction(
        getInteractionContext(),
        pos,
        color,
        false,
        undefined,
        selectedLabel.value
      );
    }

    mode.value = { kind: "drawing" };

    // For tools that need the initial pointer-down event (e.g. mask/brush),
    // fire it immediately so the first stroke is painted.
    if (activeInteraction.value && activeInteraction.value.toolType === "mask") {
      const result = activeInteraction.value.onPointerDown(pos);
      handleInteractionResult(result);
    }
  };

  const isPointWithinParent = (
    point: { x: number; y: number },
    parentIndex: number
  ): boolean => {
    const parent = annotations.value[parentIndex];
    if (!parent) return false;

    const canvasPoints = getCanvasCoordinates(parent.points, imageNode);
    return checkPointWithinParent(point, canvasPoints);
  };

  /**
   * Complete the current interaction and create annotation or hole
   */
  const completeInteraction = () => {
    if (!activeInteraction.value) return;

    const annotation = activeInteraction.value.complete();

    if (annotation) {
      // Check if we're editing an existing mask annotation
      const editingMaskIndex =
        editMode.value.active &&
        editMode.value.annotationIndex !== null &&
        activeInteraction.value.toolType === "mask"
          ? editMode.value.annotationIndex
          : -1;

      if (editingMaskIndex >= 0) {
        // Replace the existing annotation in-place
        answer.values[editingMaskIndex] = annotation;
        // Exit edit mode
        sharedState.editModeActive.value = false;
        sharedState.currentAnnotationIndex.value = null;
        (answer as any).editModeState = false;
      } else {
        // Normal annotation creation — push new
        answer.values.push(annotation);
      }
      updateAnswer();
    } else if (
      activeInteraction.value.isHole &&
      activeInteraction.value.parentIndex !== undefined
    ) {
      // Hole creation
      const parentIndex = activeInteraction.value.parentIndex;
      const parent = annotations.value[parentIndex];

      // Use utility to complete hole creation
      const success = completeHoleCreation(
        activeInteraction.value,
        parent,
        getImageCoordinates,
        imageNode
      );

      if (!success) {
        // Failed to create hole - cleanup and exit
        activeInteraction.value.cleanup();
        activeInteraction.value = null;
        mode.value = { kind: "idle" };
        return;
      }

      updateAnswer();

      // Stay in hole drawing mode for adding more holes
      highlightParentForHoleDrawing(parentIndex);
    }

    activeInteraction.value.cleanup();
    activeInteraction.value = null;
    mode.value = { kind: "idle" };
    renderAnnotations();
  };

  /**
   * Cancel the current interaction
   */
  const cancelInteraction = () => {
    if (!activeInteraction.value) return;

    // For mask interactions, always auto-complete (save) instead of discarding
    if (activeInteraction.value.toolType === "mask") {
      const isMaskEdit =
        editMode.value.active &&
        editMode.value.annotationIndex !== null;

      if (isMaskEdit) {
        // Edit mode: replace existing annotation in-place
        const editingIndex = editMode.value.annotationIndex!;
        const result = activeInteraction.value.complete();
        if (result && editingIndex >= 0) {
          answer.values[editingIndex] = result;
        }
        sharedState.editModeActive.value = false;
        sharedState.currentAnnotationIndex.value = null;
        (answer as any).editModeState = false;
        restoreAllAnnotations();
      } else {
        // Normal drawing: save as new annotation
        const result = activeInteraction.value.complete();
        if (result) {
          answer.values.push(result);
        }
      }
      activeInteraction.value.cleanup();
      activeInteraction.value = null;
      mode.value = { kind: "idle" };
      updateAnswer();
      renderAnnotations();
      return;
    }

    activeInteraction.value.cancel();
    activeInteraction.value = null;
    mode.value = { kind: "idle" };
  };

  const highlightAnnotation = (index: number, highlight: boolean) => {
    if (!renderer) return;
    const isEditing =
      editMode.value.active && editMode.value.annotationIndex === index;
    const annotation = annotations.value[index];
    const color = getAnnotationColor(annotation.label);

    renderer.highlightAnnotation(index, highlight, isEditing, color);
  };

  const hoverAnnotation = (index: number) => {
    hoveredAnnotation.value = index;
    if (!editMode.value.active) {
      highlightAnnotation(index, true);
    }
  };

  const unhoverAnnotation = () => {
    if (hoveredAnnotation.value !== null && !editMode.value.active) {
      highlightAnnotation(hoveredAnnotation.value, false);
    }
    hoveredAnnotation.value = null;
  };

  const enterEditMode = (annotationIndex: number) => {
    // Cancel any ongoing drawing
    if (activeInteraction.value) {
      cancelInteraction();
    }

    // Exit hole drawing mode if active
    if (sharedState.holeDrawingMode.value.active) {
      const parentIndex = sharedState.holeDrawingMode.value.parentIndex;

      // Restore all annotations
      restoreAllAnnotations();

      // Remove parent highlight
      if (parentIndex !== null) {
        highlightAnnotation(parentIndex, false);
      }

      // Clear hole drawing mode
      sharedState.holeDrawingMode.value = {
        active: false,
        parentIndex: null,
      };
    }

    // Update mode state
    mode.value = { kind: "edit", annotationIndex };

    // Update sharedState (editMode computed will reflect this)
    sharedState.editModeActive.value = true;
    sharedState.currentAnnotationIndex.value = annotationIndex;

    // Broadcast edit mode state to question component
    (answer as any).editModeState = true;

    // Signal to question component to select the annotation's label
    const annotation = annotations.value[annotationIndex];
    if (annotation && annotation.label) {
      sharedState.selectLabelData.value = {
        labelValue: annotation.label,
      };
      sharedState.selectLabelTrigger.value++;
    }

    // For mask annotations, enter a drawing interaction on the existing mask
    if (annotation && annotation.shape_type === "mask" && annotation.mask_data) {
      // Hide the rendered mask shape so the preview replaces it
      const shapeNode = annotationLayer?.findOne(
        `#annotation-${annotationIndex}`
      );
      if (shapeNode) shapeNode.hide();

      // Fade other annotations
      fadeNonEditedAnnotations(annotationIndex);

      // Create a MaskInteraction preloaded with the existing mask data
      const img = imageNode?.image() as HTMLImageElement | undefined;
      if (img && imageNode) {
        const imageWidth = img.naturalWidth || img.width;
        const imageHeight = img.naturalHeight || img.height;
        const color = getAnnotationColor(annotation.label);
        const label = answer.options.find(
          (opt) => opt.value === annotation.label
        );

        const interaction = new MaskInteraction(
          getInteractionContext(),
          label ? { value: label.value, color: label.color || color } : undefined,
          imageWidth,
          imageHeight,
          sharedState.brushSize.value,
          sharedState.brushMode.value,
          color
        );
        interaction.loadMaskData(annotation.mask_data);

        activeInteraction.value = interaction;
        // Switch mode to drawing so pointer events are dispatched to the interaction
        mode.value = { kind: "drawing" };

        // Switch the UI tool to mask so brush controls are shown
        sharedState.selectedTool.value = "mask";
      }

      contextMenu.hide();
      annotationLayer?.batchDraw();
      return;
    }

    // Move edited shape to top of z-order (so it receives events first)
    const shapeNode = annotationLayer?.findOne(
      `#annotation-${annotationIndex}`
    );
    const groupNode = annotationLayer?.findOne(
      `.annotation-group#annotation-${annotationIndex}`
    );
    if (shapeNode) {
      shapeNode.moveToTop();
    } else if (groupNode) {
      groupNode.moveToTop();
    }

    // Show anchor points for the selected annotation
    renderAnchorPoints(annotationIndex);

    // Highlight the annotation
    highlightAnnotation(annotationIndex, true);

    // Fade other annotations
    fadeNonEditedAnnotations(annotationIndex);

    contextMenu.hide();

    annotationLayer?.batchDraw();
  };

  const exitEditMode = () => {
    // If there's an active mask drawing interaction from mask edit, auto-complete
    // it so the user's edits are saved.
    if (activeInteraction.value && activeInteraction.value.toolType === "mask") {
      const editingIndex = editMode.value.annotationIndex;
      const result = activeInteraction.value.complete();
      if (result && editingIndex !== null && editingIndex >= 0) {
        answer.values[editingIndex] = result;
        updateAnswer();
      }
      activeInteraction.value.cleanup();
      activeInteraction.value = null;
    }

    if (editMode.value.annotationIndex !== null) {
      highlightAnnotation(editMode.value.annotationIndex, false);
    }

    removeAnchorPoints();

    // Restore original z-order by re-rendering all annotations
    // This ensures consistent ordering based on array index
    renderAnnotations();

    restoreAllAnnotations();

    // Update mode state
    mode.value = { kind: "idle" };

    // Update sharedState (editMode computed will reflect this)
    sharedState.editModeActive.value = false;
    sharedState.currentAnnotationIndex.value = null;

    // Broadcast edit mode state to question component
    (answer as any).editModeState = false;

    annotationLayer?.batchDraw();
  };

  const editNextAnnotation = () => {
    if (!editMode.value.active || editMode.value.annotationIndex === null)
      return;

    const currentIndex = editMode.value.annotationIndex;
    const nextIndex = (currentIndex + 1) % annotations.value.length;

    enterEditMode(nextIndex);
  };

  const editPreviousAnnotation = () => {
    if (!editMode.value.active || editMode.value.annotationIndex === null)
      return;

    const currentIndex = editMode.value.annotationIndex;
    const prevIndex =
      currentIndex === 0 ? annotations.value.length - 1 : currentIndex - 1;

    enterEditMode(prevIndex);
  };

  /**
   * Delete a shape (annotation) from the canvas and data.
   * Called from: question list, context menu, keyboard shortcuts.
   */
  const deleteShape = (index: number) => {
    // If we're in edit mode and deleting the shape being edited, exit edit mode first
    // This ensures anchor points and edge handles are properly removed
    if (editMode.value.active && editMode.value.annotationIndex === index) {
      exitEditMode();
    }

    answer.deleteAnnotation(index);

    // Update answer - this triggers the watch on answer.values.length which re-renders the canvas
    updateAnswer();
  };

  const enterHoleDrawingMode = (parentIndex: number) => {
    // Masks cannot have holes
    const targetAnnotation = annotations.value[parentIndex];
    if (targetAnnotation && targetAnnotation.shape_type === "mask") return;

    // Cancel any ongoing drawing
    if (activeInteraction.value) {
      cancelInteraction();
    }

    // Exit edit mode if active
    if (editMode.value.active) {
      exitEditMode();
    }

    // Check if parent already has maximum holes
    const parent = annotations.value[parentIndex];
    if (parent.holes && parent.holes.length >= MAX_HOLES_PER_SHAPE) {
      notification.notify({
        message: `Maximum ${MAX_HOLES_PER_SHAPE} holes per shape reached`,
        type: "warning",
      });
      return;
    }

    // Set hole drawing mode
    sharedState.holeDrawingMode.value = {
      active: true,
      parentIndex,
    };

    // Highlight the parent shape
    highlightParentForHoleDrawing(parentIndex);

    // Fade other annotations
    fadeNonEditedAnnotations(parentIndex);
  };

  const exitHoleDrawingMode = () => {
    if (!sharedState.holeDrawingMode.value.active) return;

    // Cancel any ongoing drawing
    if (activeInteraction.value) {
      cancelInteraction();
    }

    const parentIndex = sharedState.holeDrawingMode.value.parentIndex;

    // Restore all annotations
    restoreAllAnnotations();

    // Remove parent highlight
    if (parentIndex !== null) {
      highlightAnnotation(parentIndex, false);
    }

    // Clear hole drawing mode
    sharedState.holeDrawingMode.value = {
      active: false,
      parentIndex: null,
    };
  };

  const highlightParentForHoleDrawing = (parentIndex: number) => {
    if (!renderer) return;
    const annotation = annotations.value[parentIndex];
    renderer.highlightParentForHoleDrawing(parentIndex, annotation);
  };

  const fadeNonEditedAnnotations = (editingIndex: number) => {
    if (!renderer) return;
    renderer.fadeNonEditedAnnotations(editingIndex, annotations.value);
  };

  const restoreAllAnnotations = () => {
    if (!renderer) return;
    renderer.restoreAllAnnotations(annotations.value);
  };

  const renderAnchorPoints = (annotationIndex: number) => {
    if (!renderer) return;

    const annotation = annotations.value[annotationIndex];
    if (!annotation) return;

    const color = getAnnotationColor(annotation.label);

    const anchorConfig = {
      annotationIndex,
      pointIndex: 0, // Will be overridden by tool
      holeIndex: null,
      onDragStart: (annIdx: number, ptIdx: number, holeIdx: number | null) => {
        draggingPoint.value = {
          annotationIndex: annIdx,
          pointIndex: ptIdx,
          holeIndex: holeIdx,
        };
      },
      onDragMove: (
        annIdx: number,
        ptIdx: number,
        pos: { x: number; y: number },
        holeIdx: number | null
      ) => {
        // Constrain point if editing a hole
        let constrainedPos = pos;
        if (holeIdx !== null && toolFactory) {
          // Get the tool for the hole being dragged (not the parent)
          const holeShape = annotation.holes?.[holeIdx];
          if (holeShape) {
            const holeTool = toolFactory.getTool(holeShape.shape_type);
            if (holeTool) {
              constrainedPos = holeTool.constrainPointToParentShape(
                annotation,
                pos,
                holeIdx
              );
            }
          }
        }
        updateAnnotationFromDrag(annIdx, ptIdx, constrainedPos, holeIdx);

        // Update anchor point positions for rectangles during drag
        // This ensures all corner anchors move correctly when dragging any corner
        const targetAnnotation = annotations.value[annIdx];
        if (targetAnnotation && renderer) {
          // Check if we're dragging a rectangle (parent or hole)
          const targetShape =
            holeIdx !== null
              ? targetAnnotation.holes?.[holeIdx]
              : targetAnnotation;
          if (targetShape && targetShape.shape_type === "rectangle") {
            renderer.updateRectangleAnchorPositions(
              annIdx,
              holeIdx,
              targetAnnotation
            );
          }
        }
      },
      onDragEnd: (annIdx: number) => {
        finalizeAnnotationEdit(annIdx);
        draggingPoint.value = null;
      },
      attachContextMenuHandler: contextMenu.attachContextMenuHandler,
    };

    renderer.renderAnchorPoints(
      annotation,
      annotationIndex,
      color,
      anchorConfig
    );
  };

  const removeAnchorPoints = () => {
    if (!renderer) return;
    renderer.removeAnchorPoints();
  };

  const updateAnnotationFromDrag = (
    annotationIndex: number,
    pointIndex: number,
    newPos: { x: number; y: number },
    holeIndex: number | null
  ) => {
    const annotation = annotations.value[annotationIndex];
    if (!annotation || !toolFactory) return;

    // Determine which shape is being dragged (hole or parent)
    const targetShape =
      holeIndex !== null ? annotation.holes?.[holeIndex] : annotation;
    if (!targetShape) return;

    // Get the tool for the actual shape being dragged
    const tool = toolFactory.getTool(targetShape.shape_type);
    if (!tool) return;

    tool.updateAnnotationFromDrag(annotation, pointIndex, newPos, holeIndex);
    updateAnnotationShape(annotationIndex);
  };

  const updateAnnotationShape = (annotationIndex: number) => {
    const annotation = annotations.value[annotationIndex];
    if (!annotation || !toolFactory) return;

    const tool = toolFactory.getTool(annotation.shape_type);
    if (!tool) return;

    tool.updateAnnotationShape(annotation, annotationIndex);
  };

  const finalizeAnnotationEdit = (annotationIndex: number) => {
    // Save the changes
    updateAnswer();

    // Re-render anchor points at new positions
    renderAnchorPoints(annotationIndex);
  };

  const initCanvas = () => {
    if (!canvasContainer.value) return;

    // Use composable to initialize stage and layers
    const stageRefs = initKonvaStage(
      canvasContainer.value,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp
    );

    stage = stageRefs.stage;
    imageLayer = stageRefs.imageLayer;
    annotationLayer = stageRefs.annotationLayer;

    // Initialize tool factory after layers are created
    initializeToolFactory();

    // Use composable to load image
    loadImageNode(content, stage, imageLayer)
      .then(({ imageNode: node, originalWidth, originalHeight }) => {
        imageNode = node;
        originalImageWidth = originalWidth;
        originalImageHeight = originalHeight;

        // Initialize renderer AFTER imageNode is available
        // This ensures coordinate transformations work correctly
        initializeRenderer();

        imageLoaded.value = true;
        renderAnnotations();
      })
      .catch(() => {
        hasError.value = true;
      });

    // Keyboard listener now handled by useKeyboardShortcuts composable
  };

  // Handle mouse events
  const handleMouseDown = (e: any) => {
    // Ignore right-click for drawing (allow context menu to work naturally)
    const nativeEvent = e?.evt;
    if (nativeEvent && nativeEvent.button !== undefined && nativeEvent.button !== 0) return;

    const pos = stage?.getPointerPosition();
    if (!pos) return;

    if (activeInteraction.value) {
      // Delegate to active interaction
      const result = activeInteraction.value.onPointerDown(pos);
      handleInteractionResult(result);
    } else if (mode.value.kind === "idle") {
      // Start new interaction
      startDrawingInteraction(pos);
    }
  };

  const handleMouseMove = (e: any) => {
    const pos = stage?.getPointerPosition();
    if (!pos || !activeInteraction.value) return;

    activeInteraction.value.onPointerMove(pos);
  };

  const handleMouseUp = (e: any) => {
    const pos = stage?.getPointerPosition();
    if (!pos || !activeInteraction.value) return;

    const result = activeInteraction.value.onPointerUp(pos);
    handleInteractionResult(result);
  };

  const renderAnnotations = () => {
    if (!renderer) return;
    renderer.renderAnnotations(
      annotations.value,
      contextMenu.attachContextMenuHandler
    );
  };

  const updateAnswer = () => {
    imageAnnotationQuestion.answer.response({
      value: answer.valuesAnswered,
    });
  };

  /**
   * Convert a mask annotation to a polygon annotation in-place.
   */
  const convertMaskToPolygon = (annotationIndex: number) => {
    const annotation = annotations.value[annotationIndex];
    console.log("[convertMaskToPolygon] index:", annotationIndex, "annotation:", annotation);
    console.log("[convertMaskToPolygon] shape_type:", annotation?.shape_type, "has mask_data:", !!annotation?.mask_data);
    if (!annotation || annotation.shape_type !== "mask" || !annotation.mask_data) {
      console.warn("[convertMaskToPolygon] Skipped: not a mask or no mask_data");
      return;
    }

    console.log("[convertMaskToPolygon] mask_data format:", annotation.mask_data.format, "size:", annotation.mask_data.width, "x", annotation.mask_data.height, "data length:", annotation.mask_data.data?.length);
    const points = maskToPolygonPoints(annotation.mask_data);
    console.log("[convertMaskToPolygon] extracted points:", points?.length ?? "null");
    if (!points || points.length < 3) {
      notification.notify({
        message: "Could not convert mask to polygon — mask may be too small or empty",
        type: "warning",
      });
      return;
    }

    // Replace the annotation in-place
    annotation.shape_type = "polygon";
    annotation.points = points;
    delete (annotation as any).mask_data;

    updateAnswer();
    renderAnnotations();
  };

  // Initialize composables after all functions are declared
  // Context menu (consolidated state + handlers)
  const contextMenu = useContextMenu({
    onDelete: deleteShape,
    onEdit: enterEditMode,
    onAddHole: enterHoleDrawingMode,
    onConvertToPolygon: convertMaskToPolygon,
    onDeleteHole: (annotationIndex, holeIndex) => {
      const annotation = annotations.value[annotationIndex];
      if (annotation && annotation.holes && annotation.holes[holeIndex]) {
        annotation.holes.splice(holeIndex, 1);
        if (annotation.holes.length === 0) {
          delete annotation.holes;
        }
        updateAnswer();
        renderAnnotations();
        if (
          editMode.value.active &&
          editMode.value.annotationIndex === annotationIndex
        ) {
          renderAnchorPoints(annotationIndex);
        }
      }
    },
  });

  // Keyboard shortcuts
  useKeyboardShortcuts(
    {
      mode,
      activeInteraction,
      holeDrawingModeActive: computed(
        () => sharedState.holeDrawingMode.value.active
      ),
      annotationCount: computed(() => annotations.value.length),
    },
    {
      onExitEditMode: exitEditMode,
      onNextAnnotation: editNextAnnotation,
      onPreviousAnnotation: editPreviousAnnotation,
      onDeleteInEditMode: () => {
        if (mode.value.kind === "edit" && mode.value.annotationIndex !== null) {
          const indexToDelete = mode.value.annotationIndex;
          if (annotations.value.length > 1) {
            editNextAnnotation();
          } else {
            exitEditMode();
          }
          deleteShape(indexToDelete);
        }
      },
      onExitHoleDrawingMode: exitHoleDrawingMode,
      onInteractionKeyDown: (e) => {
        if (activeInteraction.value) {
          const result = activeInteraction.value.onKeyDown(e);
          handleInteractionResult(result);
        }
      },
    }
  );

  // Watch for changes in annotations from the question component
  watch(
    () => answer.values.length,
    () => {
      renderAnnotations();
    }
  );

  // Watch for cancel/switch-tool signal from question component
  watch(sharedState.cancelPolygonTrigger, () => {
    if (activeInteraction.value) {
      // Auto-complete mask interactions so the user doesn't lose their work
      if (activeInteraction.value.toolType === "mask") {
        completeInteraction();
      } else {
        cancelInteraction();
      }
    }
  });

  // Watch for enter edit mode signal from question component
  watch(sharedState.enterEditModeTrigger, () => {
    const editModeData = sharedState.enterEditModeData.value;
    if (
      editModeData &&
      editModeData.index !== null &&
      editModeData.index !== undefined
    ) {
      enterEditMode(editModeData.index);
    }
  });

  // Watch for exit edit mode signal from question component
  watch(sharedState.exitEditModeTrigger, () => {
    if (editMode.value.active) {
      exitEditMode();
    }
  });

  // Watch for delete shape signal from question component
  watch(sharedState.deleteShapeTrigger, () => {
    const deleteData = sharedState.deleteShapeData.value;
    if (
      deleteData &&
      deleteData.index !== null &&
      deleteData.index !== undefined
    ) {
      deleteShape(deleteData.index);
    }
  });

  // Watch for delete hole signal from question component
  watch(sharedState.deleteHoleTrigger, () => {
    const deleteData = sharedState.deleteHoleData.value;
    if (
      deleteData &&
      deleteData.annotationIndex !== null &&
      deleteData.holeIndex !== null
    ) {
      const annotation = annotations.value[deleteData.annotationIndex];
      if (
        annotation &&
        annotation.holes &&
        annotation.holes[deleteData.holeIndex]
      ) {
        // Remove the hole from the array
        annotation.holes.splice(deleteData.holeIndex, 1);

        // If no holes left, remove the holes array
        if (annotation.holes.length === 0) {
          delete annotation.holes;
        }

        // Update the answer
        updateAnswer();

        // Re-render the canvas
        renderAnnotations();

        // If in edit mode for this annotation, re-render anchor points
        if (
          editMode.value.active &&
          editMode.value.annotationIndex === deleteData.annotationIndex
        ) {
          renderAnchorPoints(deleteData.annotationIndex);
        }
      }
    }
  });

  // Watch for label reassignment in edit mode
  watch(sharedState.reassignLabelTrigger, () => {
    const reassignData = sharedState.reassignLabelData.value;
    if (
      reassignData &&
      editMode.value.active &&
      editMode.value.annotationIndex !== null
    ) {
      const annotationIndex = editMode.value.annotationIndex;
      const annotation = annotations.value[annotationIndex];

      if (annotation) {
        // Update the annotation's label
        annotation.label = reassignData.labelValue;

        // Re-render the annotation with new color
        renderAnnotations();

        // Re-render anchor points if in edit mode
        renderAnchorPoints(annotationIndex);

        // Update the answer
        updateAnswer();
      }
    }
  });

  // Watch for label changes: auto-complete active mask interaction when label switches
  watch(selectedLabel, (newLabel, oldLabel) => {
    if (
      activeInteraction.value &&
      activeInteraction.value.toolType === "mask" &&
      newLabel?.value !== oldLabel?.value
    ) {
      completeInteraction();
    }
  });

  // Watch for brush size changes
  watch(() => sharedState.brushSize.value, (newSize) => {
    if (selectedTool.value === "mask" && toolFactory) {
      const maskTool = toolFactory.getTool("mask");
      if (maskTool && 'setBrushSize' in maskTool) {
        (maskTool as any).setBrushSize(newSize);
      }
      // Update active interaction if drawing
      if (activeInteraction.value && 'setBrushSize' in activeInteraction.value) {
        (activeInteraction.value as any).setBrushSize(newSize);
      }
    }
  });

  // Watch for brush mode changes
  watch(() => sharedState.brushMode.value, (newMode) => {
    if (selectedTool.value === "mask" && toolFactory) {
      const maskTool = toolFactory.getTool("mask");
      if (maskTool && 'setBrushMode' in maskTool) {
        (maskTool as any).setBrushMode(newMode);
      }
      // Update active interaction if drawing
      if (activeInteraction.value && 'setBrushMode' in activeInteraction.value) {
        (activeInteraction.value as any).setBrushMode(newMode);
      }
    }
  });

  // Watch for hole drawing mode signal from question component
  watch(sharedState.holeDrawingMode, (holeMode, oldHoleMode) => {
    // Enter hole drawing mode when activated from question component
    if (holeMode.active && holeMode.parentIndex !== null) {
      // Check if this is a new activation (not already in hole mode for this parent)
      const isNewActivation =
        !oldHoleMode?.active ||
        oldHoleMode.parentIndex !== holeMode.parentIndex;
      if (isNewActivation) {
        enterHoleDrawingMode(holeMode.parentIndex);
      }
    }
  });

  onMounted(() => {
    initCanvas();

    // Close context menu on click outside
    document.addEventListener("click", contextMenu.hide);
  });

  onUnmounted(() => {
    document.removeEventListener("click", contextMenu.hide);
  });

  stage?.destroy();

  const contextMenuAnnotationIsMask = computed(() => {
    const idx = contextMenu.state.value.annotationIndex;
    if (idx === null || idx === undefined) return false;
    const ann = annotations.value[idx];
    return ann?.shape_type === "mask";
  });

  return {
    canvasContainer,
    imageLoaded,
    hasError,
    contextMenu: contextMenu.state,
    contextMenuAnnotationIsMask,
    annotations,
    editMode,
    holeDrawingMode: computed(() => sharedState.holeDrawingMode.value),
    deleteShape,
    handleContextMenuDelete: contextMenu.handleDelete,
    handleContextMenuEdit: contextMenu.handleEdit,
    handleContextMenuAddHole: contextMenu.handleAddHole,
    handleContextMenuDeleteHole: contextMenu.handleDeleteHole,
    handleContextMenuConvertToPolygon: contextMenu.handleConvertToPolygon,
    enterEditMode,
    exitEditMode,
    exitHoleDrawingMode,
    editNextAnnotation,
    editPreviousAnnotation,
  };
};
