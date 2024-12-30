<template>
  <form @submit.prevent="submit">
    <k-input v-model="content" placeholder="输入记忆内容" />
    <k-input v-model="tags" placeholder="输入标签（逗号分隔）" />
    <k-button type="submit">添加记忆</k-button>
  </form>
</template>

<script lang="ts" setup>
import { ref } from 'vue';

const content = ref('');
const tags = ref('');

const emit = defineEmits(['submit']);

const submit = () => {
  const tagList = tags.value.split(',').map((tag) => tag.trim());
  emit('submit', content.value, tagList);
  content.value = '';
  tags.value = '';
};
</script>
