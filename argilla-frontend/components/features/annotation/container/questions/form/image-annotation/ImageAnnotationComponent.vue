<template>
  <div class="wrapper">
    <QuestionHeaderComponent :question="question" />
    
    <div class="image-annotation-question">
      <!-- Tool Selection -->
      <div class="image-annotation-question__tools">
        <h4 class="section-title">Drawing Tools</h4>
        <div class="tools-list">
          <button
            v-for="tool in tools"
            :key="tool.type"
            class="tool-button"
            :class="{ 
              'tool-button--active': selectedTool === tool.type,
              'tool-button--disabled': editModeActive 
            }"
            @click="selectTool(tool.type)"
            :title="tool.label"
            :disabled="editModeActive"
          >
            <span class="tool-icon"><svgicon :name="tool.icon" width="14" height="14" /></span>
            <span class="tool-label">{{ tool.label }}</span>
          </button>
        </div>
      </div>

      <!-- Brush Controls (shown when mask tool is selected) -->
      <div v-if="selectedTool === 'mask'" class="image-annotation-question__brush-controls">
        <h4 class="section-title">Brush Settings</h4>
        <div class="brush-controls">
          <div class="brush-size-control">
            <label class="brush-label">
              Brush Size: <span class="brush-value">{{ brushSize }}px</span>
            </label>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              :value="brushSize"
              @input="onBrushSizeChange($event)"
              class="brush-slider"
            />
          </div>
          <div class="brush-mode-control">
            <label class="brush-label">Mode:</label>
            <div class="brush-mode-buttons">
              <button
                class="brush-mode-button"
                :class="{ 'brush-mode-button--active': brushMode === 'brush' }"
                @click="setBrushMode('brush')"
                title="Brush mode (B)"
              >
                <svgicon name="brush" width="14" height="14" />
                Brush
              </button>
              <button
                class="brush-mode-button"
                :class="{ 'brush-mode-button--active': brushMode === 'eraser' }"
                @click="setBrushMode('eraser')"
                title="Eraser mode (E)"
              >
                <svgicon name="eraser" width="14" height="14" />
                Eraser
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- AI Mask Generation -->
      <div class="image-annotation-question__ai-mask">
        <h4 class="section-title">AI Mask Generation</h4>
        <div class="ai-mask-controls">
          <div class="ai-mask-prompt-row">
            <input
              type="text"
              class="ai-mask-input"
              v-model="aiMaskPrompt"
              placeholder="Describe object to segment (e.g. 'dog')"
              @keydown.stop
              @keydown.enter="requestAiMask"
              :disabled="aiMaskLoading"
            />
            <button
              class="ai-mask-button"
              :class="{ 'ai-mask-button--loading': aiMaskLoading }"
              @click="requestAiMask"
              :disabled="aiMaskLoading"
              title="Generate AI mask"
            >
              <span v-if="aiMaskLoading" class="ai-mask-spinner" />
              <span v-else>✨ Generate</span>
            </button>
          </div>

          <!-- Threshold Controls -->
          <details class="ai-mask-thresholds">
            <summary class="ai-mask-thresholds__summary">Thresholds</summary>
            <div class="ai-mask-thresholds__content">
              <div class="ai-mask-threshold-control">
                <label class="brush-label" title="Filters which object instances are returned. Lower = more instances (including low-confidence ones).">
                  Confidence: <span class="brush-value">{{ aiMaskThreshold.toFixed(2) }}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  v-model.number="aiMaskThreshold"
                  class="brush-slider"
                  title="Filters which object instances are returned. Lower = more instances."
                />
              </div>
              <div class="ai-mask-threshold-control">
                <label class="brush-label" title="Controls the binary mask cutoff per pixel. Lower = larger/looser masks, higher = tighter masks.">
                  Mask: <span class="brush-value">{{ aiMaskMaskThreshold.toFixed(2) }}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  v-model.number="aiMaskMaskThreshold"
                  class="brush-slider"
                  title="Controls the binary mask cutoff per pixel. Lower = larger masks."
                />
              </div>
            </div>
          </details>

          <!-- Error Message -->
          <div v-if="aiMaskError" class="ai-mask-error">
            {{ aiMaskError }}
          </div>

          <!-- Mask Results Gallery -->
          <div v-if="aiMaskResults && aiMaskResults.num_instances > 0" class="ai-mask-results">
            <label class="brush-label">
              Select masks ({{ aiMaskSelected.size }} selected of {{ aiMaskResults.num_instances }} found):
            </label>
            <div class="ai-mask-gallery">
              <button
                v-for="(mask, idx) in aiMaskResults.masks"
                :key="idx"
                class="ai-mask-thumb"
                :class="{ 'ai-mask-thumb--selected': aiMaskSelected.has(idx) }"
                @click="toggleAiMask(idx)"
                :title="`Mask ${idx + 1} — score ${aiMaskResults.scores[idx].toFixed(2)}`"
              >
                <img
                  :src="'data:image/png;base64,' + mask"
                  class="ai-mask-thumb__img"
                />
                <span class="ai-mask-thumb__score">{{ aiMaskResults.scores[idx].toFixed(2) }}</span>
                <span v-if="aiMaskSelected.has(idx)" class="ai-mask-thumb__check">&#10003;</span>
              </button>
            </div>
            <div class="ai-mask-apply-row">
              <button
                class="ai-mask-button"
                :disabled="aiMaskSelected.size === 0"
                @click="applySelectedAiMasks"
              >
                Apply {{ aiMaskSelected.size }} mask{{ aiMaskSelected.size !== 1 ? 's' : '' }}
              </button>
              <button
                class="ai-mask-clear-button"
                :disabled="aiMaskSelected.size === 0"
                @click="clearAiMaskSelection"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Label Selection - Using Span Annotation Component -->
      <div class="image-annotation-question__labels">
        <h4 class="section-title">Labels</h4>
        <EntityLabelSelectionComponent
          v-model="question.answer.options"
          :componentId="question.id"
          :maxOptionsToShowBeforeCollapse="question.settings.visible_options"
          :isFocused="isFocused"
          :visibleShortcuts="true"
          @on-selected="onLabelSelected"
          @on-focus="onFocus"
        />
      </div>

      <!-- Annotations List -->
      <div class="image-annotation-question__annotations">
        <h4 class="section-title">Annotations ({{ annotations.length }})</h4>
        <div class="image-annotation-question__annotations-container">
          <div class="annotations-list">
            <div
              v-for="(annotation, index) in annotations"
              :key="`annotation-${index}-${annotation.label}`"
              class="annotation-group"
              @click="onAnnotationItemClick(index)"
            >
              <!-- Parent Annotation -->
              <div
                class="annotation-item"
                :class="{ 'annotation-item--hovered': hoveredAnnotation === index }"
                @mouseenter="hoverAnnotation(index)"
                @mouseleave="unhoverAnnotation()"
              >
                <!-- Expand/Collapse Button (only if has holes, not for masks) -->
                <button
                  v-if="annotation.shape_type !== 'mask' && annotation.holes && annotation.holes.length > 0"
                  class="annotation-expand"
                  @click.stop="toggleExpanded(index)"
                  :title="isExpanded(index) ? $t('imageAnnotation.buttons.collapse') : $t('imageAnnotation.buttons.expand')"
                >
                  <span class="expand-icon">{{ isExpanded(index) ? '▼' : '▶' }}</span>
                </button>
                <span v-else class="annotation-expand-spacer" />
                
                <span
                  class="annotation-color"
                  :style="{ backgroundColor: getAnnotationColor(annotation.label) }"
                />
                <span class="annotation-label">{{ annotation.label }}</span>
                <span class="annotation-type">{{ annotation.shape_type }}</span>
                
                <!-- Hole Count Badge -->
                <span
                  v-if="annotation.shape_type !== 'mask' && annotation.holes && annotation.holes.length > 0"
                  class="annotation-hole-badge"
                  :title="$tc('imageAnnotation.tooltips.holesCount', annotation.holes.length, { count: annotation.holes.length })"
                >
                  <span class="hole-icon">⬚</span>
                  {{ annotation.holes.length }}
                </span>
                
                <div class="annotation-actions">
                  <!-- Add Hole Button (not for masks) -->
                  <button
                    v-if="annotation.shape_type !== 'mask' && (!annotation.holes || annotation.holes.length < 10)"
                    class="annotation-add-hole"
                    @click.stop="onAddHole(index)"
                    :title="$t('imageAnnotation.buttons.addHole')"
                  >
                    <span class="add-hole-icon">⬚</span>
                  </button>
                  
                  <button
                    class="annotation-edit"
                    @click.stop="onEditAnnotation(index)"
                    :title="$t('imageAnnotation.buttons.edit')"
                  >
                    <svgicon 
                      name="pen" 
                      width="12" 
                      height="12" 
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    class="annotation-delete"
                    @click.stop="deleteAnnotation(index)"
                    :title="$t('imageAnnotation.buttons.delete')"
                  >
                    <svgicon 
                      name="close" 
                      width="12" 
                      height="12" 
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
              
              <!-- Holes List (expandable, not for masks) -->
              <div
                v-if="annotation.shape_type !== 'mask' && annotation.holes && annotation.holes.length > 0"
                v-show="isExpanded(index)"
                class="holes-list"
              >
                <div
                  v-for="(hole, holeIndex) in annotation.holes"
                  :key="`${index}-hole-${holeIndex}`"
                  class="hole-item"
                >
                  <span class="hole-indent" />
                  <span class="hole-icon-small">⬚</span>
                  <span class="hole-label">Hole {{ holeIndex + 1 }}</span>
                  <span class="hole-type">{{ hole.shape_type }}</span>
                  <div class="hole-actions">
                    <button
                      class="hole-delete"
                      @click.stop="deleteHole(index, holeIndex)"
                      :title="$t('imageAnnotation.buttons.deleteHole')"
                    >
                      <svgicon 
                        name="close" 
                        width="10" 
                        height="10" 
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { useImageAnnotationQuestionViewModel } from "./useImageAnnotationQuestionViewModel";
import "assets/icons/close";
import "assets/icons/pen";
import "assets/icons/square";
import "assets/icons/heptagon";
import "assets/icons/brush";
import "assets/icons/eraser";

export default {
  name: "ImageAnnotationComponent",
  props: {
    question: {
      type: Object,
      required: true,
    },
    isFocused: {
      type: Boolean,
      default: () => false,
    },
  },
  data() {
    return {
      tools: [
        { type: "rectangle", icon: "square", label: "Rectangle" },
        { type: "polygon", icon: "heptagon", label: "Polygon" },
        { type: "mask", icon: "brush", label: "Brush/Mask" },
      ],
    };
  },
  setup(props) {
    const viewModel = useImageAnnotationQuestionViewModel(props);
    
    // Ensure rectangle tool is selected by default
    viewModel.selectTool("rectangle");
    
    // Select first label by default if none selected
    const answer = props.question.answer;
    const hasSelectedLabel = answer.options.some(opt => opt.isSelected);
    if (!hasSelectedLabel && answer.options.length > 0) {
      answer.options[0].isSelected = true;
    }
    
    return viewModel;
  },
};
</script>

<style lang="scss" scoped>
.wrapper {
  display: flex;
  flex-direction: column;
  gap: $base-space * 1.5;
}

.image-annotation-question {
  display: flex;
  flex-direction: column;
  gap: $base-space * 2;

  &__tools,
  &__labels,
  &__annotations,
  &__brush-controls,
  &__ai-mask {
    display: flex;
    flex-direction: column;
    gap: $base-space * 1.5;
  }

  &__annotations-container {
    background: var(--bg-opacity-8);
    border-radius: $border-radius-s;
    max-height: 300px;
    overflow-y: auto;
  }
}

.brush-controls {
  display: flex;
  flex-direction: column;
  gap: $base-space * 1.5;
  padding: $base-space * 1.5;
  background: var(--bg-opacity-8);
  border-radius: $border-radius-s;
}

.brush-size-control {
  display: flex;
  flex-direction: column;
  gap: $base-space;
}

.brush-label {
  font-size: 13px;
  color: var(--fg-primary);
  font-weight: 500;
}

.brush-value {
  font-weight: 600;
  color: var(--bg-brand);
}

.brush-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #4a4a5a;
  outline: none;
  cursor: pointer;
  margin: 4px 0;

  &::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: #4a4a5a;
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--bg-brand);
    cursor: pointer;
    margin-top: -6px;
    transition: all 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);

    &:hover {
      transform: scale(1.2);
    }
  }

  &::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: #4a4a5a;
    border: none;
  }

  &::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--bg-brand);
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);

    &:hover {
      transform: scale(1.2);
    }
  }
}

.brush-mode-control {
  display: flex;
  flex-direction: column;
  gap: $base-space;
}

.brush-mode-buttons {
  display: flex;
  gap: $base-space;
}

.brush-mode-button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $base-space * 0.5;
  padding: $base-space $base-space * 1.5;
  background: var(--bg-opacity-8);
  border: 1px solid var(--border-field);
  border-radius: $border-radius-s;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  color: var(--fg-primary);

  &:hover {
    background: var(--bg-opacity-16);
  }

  &--active {
    background: var(--bg-brand);
    color: white;
    border-color: var(--bg-brand);
  }
}

.section-title {
  font-weight: 600;
  color: var(--fg-primary);
  @include font-size(14px);
  margin: 0;
}

.tools-list {
  display: flex;
  gap: $base-space;
  flex-wrap: wrap;
}

.tool-button {
  display: flex;
  align-items: center;
  gap: $base-space;
  padding: $base-space $base-space * 2;
  background: var(--bg-opacity-8);
  border: 1px solid var(--border-field);
  border-radius: $border-radius-s;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  color: var(--fg-primary);

  &:hover:not(:disabled) {
    background: var(--bg-opacity-16);
  }

  &--active {
    background: var(--bg-brand);
    color: white;
    border-color: var(--bg-brand);
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: grayscale(100%);
  }
}

.tool-icon {
  font-size: 18px;
}

.tool-label {
  @include font-size(13px);
}

.annotations-list {
  display: flex;
  flex-direction: column;
  gap: $base-space * 0.5;
}

.annotation-group {
  display: flex;
  flex-direction: column;
}

.annotation-item {
  display: flex;
  align-items: center;
  gap: $base-space;
  padding: $base-space;
  border-radius: $border-radius-s;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
  will-change: background-color;

  &:hover {
    background: var(--bg-opacity-16);
  }

  &--hovered {
    background: var(--bg-opacity-24);
  }
}

.annotation-expand {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--fg-secondary);
  transition: color 0.2s;

  &:hover {
    color: var(--fg-primary);
  }
}

.expand-icon {
  font-size: 10px;
  line-height: 1;
}

.annotation-expand-spacer {
  width: 16px;
  flex-shrink: 0;
}

.annotation-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.annotation-label {
  flex: 1;
  color: var(--fg-primary);
  @include font-size(14px);
}

.annotation-type {
  color: var(--fg-secondary);
  @include font-size(12px);
  text-transform: capitalize;
}

.annotation-hole-badge {
  display: flex;
  align-items: center;
  gap: $base-space * 0.25;
  padding: $base-space * 0.25 $base-space * 0.5;
  background: var(--bg-opacity-16);
  border-radius: $border-radius-s;
  color: var(--fg-secondary);
  @include font-size(11px);
  font-weight: 600;
  flex-shrink: 0;
}

.hole-icon {
  font-size: 12px;
  line-height: 1;
  color: var(--bg-brand);
}

.annotation-actions {
  display: flex;
  gap: $base-space * 0.5;
  align-items: center;
}

.annotation-add-hole {
  background: none;
  border: 1px solid var(--border-field);
  cursor: pointer;
  padding: $base-space * 0.5;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  color: var(--fg-secondary);

  &:hover {
    background-color: var(--bg-opacity-8);
    border-color: var(--bg-brand);
    color: var(--bg-brand);
  }
}

.add-hole-icon {
  font-size: 14px;
  line-height: 1;
}

.annotation-edit,
.annotation-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: $base-space * 0.5;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s ease;

  :deep(svg) {
    fill: var(--fg-secondary);
  }

  &:hover {
    background-color: var(--bg-opacity-1);
    
    :deep(svg) {
      fill: var(--fg-primary);
    }
  }
}

.annotation-delete {
  &:hover :deep(svg) {
    fill: var(--fg-error);
  }
}

// Holes List
.holes-list {
  display: flex;
  flex-direction: column;
  gap: $base-space * 0.25;
  padding-left: $base-space * 2;
  margin-top: $base-space * 0.25;
  will-change: opacity;
  transition: opacity 0.15s ease-out;
}

.hole-item {
  display: flex;
  align-items: center;
  gap: $base-space * 0.5;
  padding: $base-space * 0.5 $base-space;
  border-radius: $border-radius-s;
  background: var(--bg-opacity-4);
  transition: background-color 0.15s ease-out;
  will-change: background-color;

  &:hover {
    background: var(--bg-opacity-12);
  }
}

.hole-indent {
  width: 2px;
  height: 16px;
  background: var(--border-field);
  flex-shrink: 0;
  border-radius: 1px;
}

.hole-icon-small {
  font-size: 12px;
  line-height: 1;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.hole-label {
  flex: 1;
  color: var(--fg-secondary);
  @include font-size(13px);
}

.hole-type {
  color: var(--fg-tertiary);
  @include font-size(11px);
  text-transform: capitalize;
}

.hole-actions {
  display: flex;
  gap: $base-space * 0.25;
  align-items: center;
}

.hole-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: $base-space * 0.25;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s ease;

  :deep(svg) {
    fill: var(--fg-tertiary);
  }

  &:hover {
    background-color: var(--bg-opacity-8);
    
    :deep(svg) {
      fill: var(--fg-error);
    }
  }
}

// AI Mask Controls
.ai-mask-controls {
  display: flex;
  flex-direction: column;
  gap: $base-space * 1.5;
  padding: $base-space * 1.5;
  background: var(--bg-opacity-8);
  border-radius: $border-radius-s;
}

.ai-mask-prompt-row {
  display: flex;
  gap: $base-space;
  align-items: stretch;
}

.ai-mask-input {
  flex: 1;
  padding: $base-space $base-space * 1.5;
  border: 1px solid var(--border-field);
  border-radius: $border-radius-s;
  background: var(--bg-opacity-4);
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;

  &::placeholder {
    color: var(--fg-secondary);
  }

  &:focus {
    border-color: var(--bg-brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.ai-mask-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $base-space * 0.5;
  padding: $base-space $base-space * 2;
  background: var(--bg-brand);
  color: white;
  border: none;
  border-radius: $border-radius-s;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &--loading {
    min-width: 100px;
  }
}

.ai-mask-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: ai-mask-spin 0.6s linear infinite;
}

@keyframes ai-mask-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-mask-thresholds {
  &__summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-secondary);
    user-select: none;
    padding: $base-space * 0.5 0;

    &:hover {
      color: var(--fg-primary);
    }
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: $base-space;
    padding-top: $base-space;
  }
}

.ai-mask-threshold-control {
  display: flex;
  flex-direction: column;
  gap: $base-space * 0.5;
}

.ai-mask-error {
  padding: $base-space;
  background: rgba(220, 53, 69, 0.1);
  border: 1px solid rgba(220, 53, 69, 0.3);
  border-radius: $border-radius-s;
  color: var(--fg-error, #dc3545);
  font-size: 12px;
}

.ai-mask-results {
  display: flex;
  flex-direction: column;
  gap: $base-space;
}

.ai-mask-gallery {
  display: flex;
  gap: $base-space;
  overflow-x: auto;
  padding: $base-space * 0.5 0;
}

.ai-mask-thumb {
  position: relative;
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border: 2px solid var(--border-field);
  border-radius: $border-radius-s;
  background: #000;
  cursor: pointer;
  padding: 0;
  overflow: hidden;
  transition: border-color 0.2s, transform 0.15s;

  &:hover {
    border-color: var(--bg-brand);
    transform: scale(1.05);
  }

  &__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  &__score {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
  }

  &__check {
    position: absolute;
    top: 2px;
    right: 2px;
    background: var(--bg-brand);
    color: white;
    font-size: 12px;
    font-weight: 700;
    width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    border-radius: 50%;
  }

  &--selected {
    border-color: var(--bg-brand);
    box-shadow: 0 0 0 2px var(--bg-brand);
  }
}

.ai-mask-apply-row {
  display: flex;
  gap: $base-space;
  align-items: center;
}

.ai-mask-clear-button {
  padding: $base-space $base-space * 1.5;
  background: transparent;
  color: var(--fg-secondary);
  border: 1px solid var(--border-field);
  border-radius: $border-radius-s;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    color: var(--fg-primary);
    border-color: var(--fg-secondary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
