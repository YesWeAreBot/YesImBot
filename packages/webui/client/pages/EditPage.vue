<template>
  <k-layout>
    <template #header>
      <h1>记忆编辑</h1>
    </template>
    <template #default>
      <k-card>
        <h2>记忆列表</h2>
        <MemoryTable
          :memories="filteredMemories"
          @delete="handleDelete"
          @edit="handleEdit"
        />
        <MemoryForm @submit="handleSubmit" />
      </k-card>
    </template>
  </k-layout>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { send } from '@koishijs/client';
import MemoryForm from '../components/MemoryForm.vue';
import MemoryTable from '../components/MemoryTable.vue';

interface Memory {
  id: string;
  content: string;
  userId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt?: number;
}

const memories = ref<Memory[]>([]);
const searchQuery = ref('');
const selectedTag = ref('');

// 获取所有记忆
const fetchMemories = async () => {
  memories.value = await send('memory/getAll');
};

// 过滤记忆
const filteredMemories = computed(() => {
  return memories.value.filter((memory) => {
    const matchesQuery = memory.content.includes(searchQuery.value);
    const matchesTag = selectedTag.value ? memory.tags?.includes(selectedTag.value) : true;
    return matchesQuery && matchesTag;
  });
});

// 处理新增记忆
const handleSubmit = async (content: string, tags: string[]) => {
  await send('memory/addText', content, tags);
  await fetchMemories();
};

// 处理删除记忆
const handleDelete = async (id: string) => {
  await send('memory/delete', id);
  await fetchMemories();
};

// 处理编辑记忆
const handleEdit = async (id: string, content: string, tags: string[]) => {
  await send('memory/update', id, { content, tags });
  await fetchMemories();
};

onMounted(fetchMemories);
</script>
