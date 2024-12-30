<template>
  <k-layout menu="memory">

    <template #left>
      <el-scrollbar>
        
      </el-scrollbar>
    </template>

    <!-- Memory Statistics -->
    <k-card class="memory-stats">
      <div class="chart-container">
        <canvas ref="chartRef"></canvas>
      </div>
      <div class="stats-info">
        <div class="stat-item">
          <div class="stat-value">{{ totalMemories }}</div>
          <div class="stat-label">总记忆数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ userMemories }}</div>
          <div class="stat-label">用户记忆</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ selfMemories }}</div>
          <div class="stat-label">自身记忆</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ generalMemories }}</div>
          <div class="stat-label">通用记忆</div>
        </div>
      </div>
    </k-card>

    <!-- Search and Filter -->
    <k-card class="memory-search">
      <div class="search-container">
        <input v-model="searchQuery" placeholder="搜索记忆..." class="search-input" @keyup.enter="searchMemories">
        <select v-model="searchType" class="search-type">
          <option value="id">ID</option>
          <option value="content">内容</option>
          <option value="tag">标签</option>
        </select>
        <button @click="searchMemories" class="search-button">搜索</button>
        <button @click="showAddDialog = true" class="add-button">添加记忆</button>
      </div>
    </k-card>

    <!-- Memory List -->
    <k-card class="memory-list">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>内容</th>
            <th>标签</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="memory in displayedMemories" :key="memory.id">
            <td>{{ memory.id }}</td>
            <td>{{ memory.content }}</td>
            <td>{{ formatTags(memory.tags) }}</td>
            <td>{{ formatDate(memory.createdAt) }}</td>
            <td>
              <button @click="editMemory(memory)" class="edit-button">编辑</button>
              <button @click="deleteMemory(memory.id)" class="delete-button">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </k-card>

    <!-- Add/Edit Dialog -->
    <div v-if="showAddDialog || editingMemory" class="dialog-overlay">
      <div class="dialog">
        <h3>{{ editingMemory ? '编辑记忆' : '添加记忆' }}</h3>
        <div class="dialog-content">
          <textarea v-model="memoryContent" placeholder="输入记忆内容..." class="memory-input"></textarea>
          <div class="tag-selector">
            <label>
              <input type="checkbox" v-model="selectedTags" value="User">
              用户记忆
            </label>
            <label>
              <input type="checkbox" v-model="selectedTags" value="Self">
              自身记忆
            </label>
            <label>
              <input type="checkbox" v-model="selectedTags" value="General">
              通用记忆
            </label>
          </div>
        </div>
        <div class="dialog-actions">
          <button @click="saveMemory" class="save-button">保存</button>
          <button @click="closeDialog" class="cancel-button">取消</button>
        </div>
      </div>
    </div>
  </k-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { send } from '@koishijs/client'
import Chart from 'chart.js/auto'

// State
const chartRef = ref(null)
const searchQuery = ref('')
const searchType = ref('content')
const showAddDialog = ref(false)
const editingMemory = ref(null)
const memoryContent = ref('')
const selectedTags = ref([])
const memories = ref([])

// Computed
const totalMemories = computed(() => memories.value.length)
const userMemories = computed(() => memories.value.filter(m => m.tags?.includes('User')).length)
const selfMemories = computed(() => memories.value.filter(m => m.tags?.includes('Self')).length)
const generalMemories = computed(() => memories.value.filter(m => m.tags?.includes('General')).length)

const displayedMemories = computed(() => {
  if (!searchQuery.value) return memories.value

  const query = searchQuery.value.toLowerCase()
  return memories.value.filter(memory => {
    switch (searchType.value) {
      case 'id':
        return memory.id.toLowerCase().includes(query)
      case 'content':
        return memory.content.toLowerCase().includes(query)
      case 'tag':
        return memory.tags?.some(tag => tag.toLowerCase().includes(query))
      default:
        return true
    }
  })
})

// Methods
const loadMemories = async () => {
  const response = await send('memory/getAll')
  memories.value = response
  updateChart()
}

const searchMemories = () => {
  // The filtering is handled by the computed property displayedMemories
}

const editMemory = (memory) => {
  editingMemory.value = memory
  memoryContent.value = memory.content
  selectedTags.value = memory.tags || []
  showAddDialog.value = true
}

const deleteMemory = async (id) => {
  if (confirm('确定要删除这条记忆吗？')) {
    await send('memory/delete', id)
    await loadMemories()
  }
}

const saveMemory = async () => {
  const memoryData = {
    content: memoryContent.value,
    tags: selectedTags.value,
  }

  if (editingMemory.value) {
    await send('memory/update', editingMemory.value.id, memoryData)
  } else {
    await send('memory/addText', memoryData.content, memoryData.tags)
  }

  closeDialog()
  await loadMemories()
}

const closeDialog = () => {
  showAddDialog.value = false
  editingMemory.value = null
  memoryContent.value = ''
  selectedTags.value = []
}

const formatTags = (tags) => {
  return tags ? tags.join(', ') : ''
}

const formatDate = (timestamp) => {
  return new Date(timestamp).toLocaleString()
}

const updateChart = () => {
  if (!chartRef.value) return

  const ctx = chartRef.value.getContext('2d')
  new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['用户记忆', '自身记忆', '通用记忆'],
      datasets: [{
        data: [userMemories.value, selfMemories.value, generalMemories.value],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  })
}

// Lifecycle
onMounted(() => {
  loadMemories()
})
</script>

<style>
.memory-stats {
  margin-bottom: 1rem;
  padding: 1rem;
}

.chart-container {
  height: 300px;
  margin-bottom: 1rem;
}

.stats-info {
  display: flex;
  justify-content: space-around;
  margin-top: 1rem;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--primary);
}

.stat-label {
  color: var(--secondary);
}

.memory-search {
  margin-bottom: 1rem;
}

.search-container {
  display: flex;
  gap: 0.5rem;
}

.search-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.search-type {
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.search-button,
.add-button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.search-button {
  background: var(--primary);
  color: white;
}

.add-button {
  background: var(--success);
  color: white;
}

.memory-list {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  background: var(--card-bg);
  font-weight: bold;
}

.edit-button,
.delete-button {
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 0.5rem;
}

.edit-button {
  background: var(--primary);
  color: white;
}

.delete-button {
  background: var(--danger);
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
  border-radius: 8px;
  padding: 1.5rem;
  width: 90%;
  max-width: 500px;
}

.dialog h3 {
  margin: 0 0 1rem 0;
}

.memory-input {
  width: 100%;
  min-height: 100px;
  padding: 0.5rem;
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  resize: vertical;
}

.tag-selector {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.save-button,
.cancel-button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.save-button {
  background: var(--primary);
  color: white;
}

.cancel-button {
  background: var(--secondary);
  color: white;
}
</style>
