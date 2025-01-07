<template>
  <k-layout menu="memory">
    <template #left>
      <el-scrollbar></el-scrollbar>
    </template>

    <MemoryStats :totalMemories="totalMemories" :userMemories="userMemories" :coreMemories="coreMemories"
      :knowledgeMemories="knowledgeMemories" />
    <MemorySearch @search="handleSearch" @add="showAddDialog = true" />
    <MemoryList :memories="displayedMemories" @edit="editMemory" @delete="deleteMemory" />

    <MemoryDialog v-if="showAddDialog || editingMemory" :memory="editingMemory" @save="saveMemory"
      @close="closeDialog" />

    <!-- 全局反馈 -->
    <el-alert v-if="feedbackMessage" :type="feedbackType" :closable="true" @close="feedbackMessage = ''">
      {{ feedbackMessage }}
    </el-alert>
  </k-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onBeforeUnmount } from 'vue'
import { send } from '@koishijs/client'
import MemoryStats from '../components/MemoryStats.vue'
import MemorySearch from '../components/MemorySearch.vue'
import MemoryList from '../components/MemoryList.vue'
import MemoryDialog from '../components/MemoryDialog.vue'
import { MemoryItem } from 'koishi-plugin-yesimbot-memory'
import { MemoryType } from '../model'

// State
const searchQuery = ref('')
const searchType = ref('content')
const showAddDialog = ref(false)
const editingMemory = ref<MemoryItem | null>(null)
const memories = ref<MemoryItem[]>([])
const feedbackMessage = ref('')
const feedbackType = ref<'success' | 'error'>('success')
const feedbackTimer = ref<NodeJS.Timeout | null>(null)

function showFeedback(message: string, type: 'success' | 'error' = 'success', duration = 2000) {
  feedbackMessage.value = message
  feedbackType.value = type

  if (feedbackTimer.value) {
    clearTimeout(feedbackTimer.value)
  }

  feedbackTimer.value = setTimeout(() => {
    feedbackMessage.value = ''
  }, duration)
}

onBeforeUnmount(() => {
  if (feedbackTimer.value) {
    clearTimeout(feedbackTimer.value)
  }
})

// Computed
const totalMemories = computed(() => memories.value.length)
const coreMemories = computed(() => memories.value.filter(m => m.type === MemoryType.Core).length)
const userMemories = computed(() => memories.value.filter(m => m.type === MemoryType.User).length)
const knowledgeMemories = computed(() => memories.value.filter(m => m.type === MemoryType.Knowledge).length)

const displayedMemories = computed(() => {
  if (!searchQuery.value) return memories.value

  const query = searchQuery.value.toLowerCase()
  return memories.value.filter(memory => {
    switch (searchType.value) {
      case 'id':
        return memory.id.toLowerCase().includes(query)
      case 'content':
        return memory.content.toLowerCase().includes(query)
      case 'topic':
        return memory.topic.toLowerCase().includes(query)
      case 'keywords':
        return memory.keywords.some(keyword => keyword.toLowerCase().includes(query))
      default:
        return true
    }
  })
})

async function loadMemories() {
  const response = await send('memory/getAll')
  memories.value = response
}

function handleSearch(query: string, type: string) {
  searchQuery.value = query
  searchType.value = type
}

function editMemory(memory: MemoryItem) {
  editingMemory.value = memory
  showAddDialog.value = true
}

async function deleteMemory(id: string) {
  if (confirm('确定要删除这条记忆吗？')) {
    try {
      await send('memory/delete', id)
      showFeedback('记忆删除成功', "success")
      await loadMemories() // 重新加载记忆列表
    } catch (err) {
      showFeedback('记忆删除失败', "error")
      console.error('删除记忆失败:', err)
    }
  }
}

async function saveMemory(memory: Partial<MemoryItem>) {
  try {
    if (editingMemory.value) {
      await send('memory/modifyMemoryById', editingMemory.value.id, memory.content, memory.type, memory.topic, memory.keywords)
      showFeedback('记忆修改成功', "success")
    } else {
      await send('memory/addCoreMemory', memory.content, memory.topic, memory.keywords)
      showFeedback('记忆添加成功', "success")
    }
    await loadMemories()
    closeDialog()
  } catch (err) {
    showFeedback('记忆保存失败', "error")
    console.error('保存记忆失败:', err)
  }
}

function closeDialog() {
  showAddDialog.value = false
  editingMemory.value = null
}

// Lifecycle
onMounted(() => {
  loadMemories()
})
</script>

<style scoped>
.el-alert {
  position: fixed;
  bottom: 2rem;
  right: 1rem;
  z-index: 1000;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  animation: slideIn 0.3s ease;
}

.el-alert--success {
  background-color: #f0f9eb;
  border-color: #e1f3d8;
}

.el-alert--error {
  background-color: #fef0f0;
  border-color: #fde2e2;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .el-alert {
    right: 0.5rem;
    left: 0.5rem;
    width: auto;
  }
}
</style>
