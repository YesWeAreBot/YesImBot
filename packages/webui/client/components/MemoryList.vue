<template>
  <k-card class="memory-list">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>内容</th>
          <th>类型</th>
          <th>主题</th>
          <th>关键词</th>
          <th>创建时间</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="memory in memories" :key="memory.id">
          <td>{{ memory.id.slice(0, 8) }}</td>
          <td>{{ memory.content }}</td>
          <td>{{ memory.type }}</td>
          <td>{{ memory.topic }}</td>
          <td>{{ formatKeywords(memory.keywords) }}</td>
          <td>{{ formatDate(memory.createdAt) }}</td>
          <td>{{ formatDate(memory.updatedAt) }}</td>
          <td>
            <button @click="emit('edit', memory)" class="edit-button">编辑</button>
            <button @click="emit('delete', memory.id)" class="delete-button">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </k-card>
</template>

<script setup lang="ts">
import { MemoryItem } from 'koishi-plugin-yesimbot-memory'
import { defineProps } from 'vue'

const props = defineProps({
  memories: { type: Array as () => MemoryItem[], required: true }
})

const emit = defineEmits(['edit', 'delete'])

function formatKeywords(keywords: string[]) {
  return keywords?.join(' | ') || ''
}

function formatDate(date: Date) {
  return date.toLocaleString()
}
</script>

<style scoped>
.memory-list {
  overflow: auto;
  max-height: 60vh;
  margin: 1rem;
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

th:nth-child(6),
td:nth-child(6),
th:nth-child(7),
td:nth-child(7) {
  width: 160px;
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
</style>
