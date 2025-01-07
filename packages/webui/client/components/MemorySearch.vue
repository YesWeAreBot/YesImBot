<template>
  <k-card class="memory-search">
    <div class="search-container">
      <div class="input-wrapper">
        <input v-model="query" placeholder="搜索记忆..." class="search-input" @keyup.enter="handleSearch">
        <button v-if="query" @click="clearQuery" class="clear-button">
          &times;
        </button>
      </div>
      <div class="select-wrapper">
        <select v-model="type" class="search-type" :disabled="isSearching">
          <option value="id">ID</option>
          <option value="content">内容</option>
          <option value="topic">主题</option>
          <option value="keywords">关键词</option>
        </select>
        <div class="select-arrow"></div>
      </div>
      <button @click="handleSearch" class="search-button" :disabled="isSearching || !query">
        <span v-if="isSearching">搜索中...</span>
        <span v-else>搜索</span>
      </button>
      <button @click="emit('add')" class="add-button" :disabled="isSearching">
        添加记忆
      </button>
    </div>
  </k-card>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits(['search', 'add'])

const query = ref('')
const type = ref('content')
const isSearching = ref(false)

function handleSearch() {
  if (!query.value || isSearching.value) return
  isSearching.value = true
  emit('search', query.value, type.value)
  setTimeout(() => {
    isSearching.value = false
  }, 1000) // 模拟搜索延迟
}

function clearQuery() {
  query.value = ''
}
</script>

<style scoped>
.memory-search {
  margin: 1rem;
  background: var(--card-bg);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.search-container {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  flex-wrap: wrap;
}

.input-wrapper {
  position: relative;
  flex: 1;
}

.search-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.1);
}

.clear-button {
  position: absolute;
  right: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 6px 6px 0;
  background: var(--bg);
  cursor: pointer;
  font-size: 1.25rem;
  color: var(--text-light);
  line-height: 1;
  transition: color 0.2s ease, background 0.2s ease;
  height: calc(100% - 1px); /* 保持与输入框一致 */
}

.clear-button:hover {
  color: var(--text);
  background: var(--hover-bg);
}

.search-type {
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card-bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.search-type:hover {
  border-color: var(--primary);
}

.search-button,
.add-button {
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.search-button {
  background: var(--primary);
  color: white;
}

.search-button:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
}

.add-button {
  background: var(--success);
  color: white;
}

.add-button:hover {
  background: var(--success-dark);
  transform: translateY(-1px);
}

.select-wrapper {
  position: relative;
}

.select-arrow {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--text-light);
}

@media (max-width: 480px) {
  .search-container {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .input-wrapper {
    width: 100%;
  }

  .search-type {
    flex: 1;
    min-width: 120px;
  }

  .search-button,
  .add-button {
    flex: 1;
    padding: 0.5rem;
    font-size: 0.9rem;
  }

  .search-button {
    order: 1;
  }

  .add-button {
    order: 2;
  }
}
</style>
