<template>
  <div>
    <ul>
      <li v-for="mem in memories" :key="mem.id">
        {{ mem.content }} <span @click="deleteMemory(mem.id)">删除</span>
      </li>
    </ul>
    <input v-model="searchQuery" placeholder="搜索记忆" />
    <button @click="searchMemories">查询</button>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { Vector } from '../types/memory';
import { fetchMemories, deleteMemory, searchMemories as apiSearchMemories } from '../helpers/api';

export default defineComponent({
  name: 'MemoryList',
  setup() {
    const memories = ref<Vector[]>([]);
    const searchQuery = ref('');

    const loadMemories = async () => {
      memories.value = await fetchMemories();
    };

    const deleteMemoryHandler = async (id: string) => {
      await deleteMemory(id);
      loadMemories();
    };

    const searchMemories = async () => {
      memories.value = await apiSearchMemories({ content: searchQuery.value });
    };

    loadMemories();

    return { memories, deleteMemoryHandler, searchMemories, searchQuery };
  }
});
</script>
