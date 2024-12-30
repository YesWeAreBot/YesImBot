<template>
  <k-layout>
    <template #header>
      <h1>记忆统计</h1>
    </template>
    <template #default>
      <k-card>
        <h2>记忆标签分布</h2>
        <MemoryChart :data="memoryStats" />
      </k-card>
    </template>
  </k-layout>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { send } from '@koishijs/client';
import MemoryChart from '../components/MemoryChart.vue';

interface Memory {
  id: string;
  content: string;
  userId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt?: number;
}

const memories = ref<Memory[]>([]);

// 获取所有记忆
const fetchMemories = async () => {
  memories.value = await send('memory/getAll');
};

// 统计记忆标签
const memoryStats = computed(() => {
  const stats: Record<string, number> = {};
  memories.value.forEach((memory) => {
    memory.tags?.forEach((tag) => {
      stats[tag] = (stats[tag] || 0) + 1;
    });
  });
  return Object.entries(stats).map(([tag, count]) => ({ tag, count }));
});

onMounted(fetchMemories);
</script>
