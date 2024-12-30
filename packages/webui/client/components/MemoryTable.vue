<template>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>内容</th>
        <th>标签</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="memory in memories" :key="memory.id">
        <td>{{ memory.id }}</td>
        <td>{{ memory.content }}</td>
        <td>{{ memory.tags?.join(', ') }}</td>
        <td>
          <k-button @click="edit(memory)">编辑</k-button>
          <k-button @click="remove(memory.id)">删除</k-button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script lang="ts" setup>
import { defineProps } from 'vue';

const props = defineProps<{
  memories: Array<{
    id: string;
    content: string;
    tags?: string[];
  }>;
}>();

const emit = defineEmits(['delete', 'edit']);

const remove = (id: string) => emit('delete', id);
const edit = (memory: { id: string; content: string; tags?: string[] }) =>
  emit('edit', memory.id, memory.content, memory.tags);
</script>
