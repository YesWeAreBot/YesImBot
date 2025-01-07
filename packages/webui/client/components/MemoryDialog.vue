<template>
  <div class="dialog-overlay">
    <div class="dialog">
      <h3>{{ memory ? '编辑记忆' : '添加记忆' }}</h3>
      <div class="dialog-content">
        <textarea v-model="content" placeholder="输入记忆内容..." class="memory-input" :disabled="isLoading"></textarea>
        <input v-model="topic" placeholder="输入主题..." class="topic-input" :disabled="isLoading" />
        <select v-model="selectedType" class="type-select" :disabled="isLoading">
          <option value="">选择类型</option>
          <option value="核心记忆">核心记忆</option>
          <option value="用户记忆">用户记忆</option>
          <option value="群成员记忆">群成员记忆</option>
          <option value="通用知识">通用知识</option>
        </select>

        <input v-model="keywordsInput" placeholder="输入关键词（逗号分隔）..." class="keywords-input" :disabled="isLoading" />
      </div>
      <div class="dialog-actions">
        <button @click="handleSave" class="save-button" :disabled="isLoading">
          <span v-if="isLoading">保存中...</span>
          <span v-else>保存</span>
        </button>
        <button @click="emit('close')" class="cancel-button" :disabled="isLoading">
          取消
        </button>
      </div>
      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MemoryItem } from 'koishi-plugin-yesimbot-memory'
import { ref, watch } from 'vue'

const props = defineProps({
  memory: { type: Object as () => MemoryItem | null, default: null }
})

const emit = defineEmits(['save', 'close'])

const content = ref(props.memory?.content || '')
const topic = ref(props.memory?.topic || '')
const selectedType = ref(props.memory?.type || '')
const keywordsInput = ref(props.memory?.keywords.join(', ') || '')
const isLoading = ref(false)
const errorMessage = ref('')

watch(() => props.memory, (newMemory) => {
  content.value = newMemory?.content || ''
  selectedType.value = newMemory?.type || ''
  topic.value = newMemory?.topic || ''
  keywordsInput.value = newMemory?.keywords.join(', ') || ''
})

async function handleSave() {
  if (isLoading.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(k => k.length > 0)
    emit('save', { content: content.value, type: selectedType.value, topic: topic.value, keywords })
  } catch (err) {
    errorMessage.value = '保存失败，请重试'
    console.error('保存记忆失败:', err)
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.type-select {
  width: 100%;
  padding: 0.75rem;
  margin: 0 0 1.25rem 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1rem;
  color: var(--text);
  background: var(--card-bg);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

/* 下拉选项的样式 */
.type-select option {
  background: var(--card-bg);
  color: var(--text);
}

/* 下拉箭头颜色 */
.type-select {
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3c/svg%3e");
  color: var(--text-primary);
}

.type-select:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.type-select option:hover {
  background-color: var(--primary);
  color: white;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.dialog h3 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
  color: var(--text-primary);
  text-align: center;
}

.dialog-content {
  padding: 0;
  margin: 0;
}

.memory-input,
.topic-input,
.keywords-input,
.type-select {
  width: 100%;
  padding: 0.75rem;
  margin: 0 0 1.25rem 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1rem;
  color: var(--text-primary);
  background: var(--card-bg);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  box-sizing: border-box;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  outline: none;
}

/* Specific styles for textarea */
.memory-input {
  min-height: 120px;
  resize: vertical;
  border-width: 1px;
  border-style: solid;
}

/* Specific styles for input */
.topic-input,
.keywords-input {
  border-width: 1px;
  border-style: solid;
}

.memory-input {
  min-height: 120px;
  resize: vertical;
}

.memory-input:focus,
.topic-input:focus,
.keywords-input:focus,
.type-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.1);
  outline: none;
}

.type-select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23007BFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 12px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.save-button,
.cancel-button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  transition: background-color 0.3s ease, transform 0.2s ease;
}

.save-button {
  background: var(--primary);
  color: white;
}

.save-button:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.save-button:disabled {
  background: var(--primary-disabled);
  cursor: not-allowed;
}

.cancel-button {
  background: var(--secondary);
  color: white;
}

.cancel-button:hover:not(:disabled) {
  background: var(--secondary-hover);
  transform: translateY(-1px);
}

.cancel-button:disabled {
  background: var(--secondary-disabled);
  cursor: not-allowed;
}

.error-message {
  color: var(--danger);
  margin-top: 1.25rem;
  text-align: center;
  font-size: 0.9rem;
}
</style>
