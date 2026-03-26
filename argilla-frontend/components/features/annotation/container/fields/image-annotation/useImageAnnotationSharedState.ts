import { ref, type Ref } from "vue-demi";
import { ImageAnnotationQuestionAnswer } from "~/v1/domain/entities/question/QuestionAnswer";

export type AiMaskData = {
  maskBase64: string;
  label: string;
  color: string;
  width: number;
  height: number;
};

export type ImageAnnotationSharedState = {
  editModeActive: Ref<boolean>;
  currentAnnotationIndex: Ref<number | null>;
  selectedTool: Ref<string>;
  brushSize: Ref<number>;
  brushMode: Ref<"brush" | "eraser">;
  // Counter-based signals - increment to trigger action
  cancelPolygonTrigger: Ref<number>;
  reassignLabelTrigger: Ref<number>;
  reassignLabelData: Ref<{ labelValue: string } | null>;
  deleteShapeTrigger: Ref<number>;
  deleteShapeData: Ref<{ index: number } | null>;
  deleteHoleTrigger: Ref<number>;
  deleteHoleData: Ref<{ annotationIndex: number; holeIndex: number } | null>;
  enterEditModeTrigger: Ref<number>;
  enterEditModeData: Ref<{ index: number } | null>;
  exitEditModeTrigger: Ref<number>;
  selectLabelTrigger: Ref<number>;
  selectLabelData: Ref<{ labelValue: string } | null>;
  holeDrawingMode: Ref<{ active: boolean; parentIndex: number | null }>;
  // AI Mask integration
  imageContent: Ref<string>;
  loadAiMaskTrigger: Ref<number>;
  loadAiMaskData: Ref<AiMaskData | null>;
  commitAiMasksTrigger: Ref<number>;
  commitAiMasksData: Ref<AiMaskData[] | null>;
};

const sharedStateMap = new WeakMap<
  ImageAnnotationQuestionAnswer,
  ImageAnnotationSharedState
>();

/**
 * Get or create shared state for an ImageAnnotationQuestionAnswer instance.
 * Uses WeakMap to avoid mutating the domain object and enable automatic garbage collection.
 */
export const useImageAnnotationSharedState = (
  answer: ImageAnnotationQuestionAnswer
): ImageAnnotationSharedState => {
  let state = sharedStateMap.get(answer);

  if (!state) {
    state = {
      editModeActive: ref(false),
      currentAnnotationIndex: ref<number | null>(null),
      selectedTool: ref("rectangle"),
      brushSize: ref(10),
      brushMode: ref("brush"),
      // Counter-based signals
      cancelPolygonTrigger: ref(0),
      reassignLabelTrigger: ref(0),
      reassignLabelData: ref(null),
      deleteShapeTrigger: ref(0),
      deleteShapeData: ref(null),
      deleteHoleTrigger: ref(0),
      deleteHoleData: ref(null),
      enterEditModeTrigger: ref(0),
      enterEditModeData: ref(null),
      exitEditModeTrigger: ref(0),
      selectLabelTrigger: ref(0),
      selectLabelData: ref(null),
      holeDrawingMode: ref({ active: false, parentIndex: null }),
      // AI Mask integration
      imageContent: ref(""),
      loadAiMaskTrigger: ref(0),
      loadAiMaskData: ref(null),
      commitAiMasksTrigger: ref(0),
      commitAiMasksData: ref(null),
    };

    sharedStateMap.set(answer, state);
  }

  return state;
};
