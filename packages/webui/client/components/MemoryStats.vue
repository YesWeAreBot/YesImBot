<template>
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
        <div class="stat-value">{{ coreMemories }}</div>
        <div class="stat-label">核心记忆</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ knowledgeMemories }}</div>
        <div class="stat-label">通用知识</div>
      </div>
    </div>
  </k-card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Chart from 'chart.js/auto'

const props = defineProps({
  totalMemories: { type: Number, required: true },
  userMemories: { type: Number, required: true },
  coreMemories: { type: Number, required: true },
  knowledgeMemories: { type: Number, required: true }
})

const chartRef = ref(null)
let chartInstance = ref<Chart | null>(null)

function updateChart() {
  if (!chartRef.value) return

  // 销毁现有的 Chart 实例
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }

  const ctx = chartRef.value.getContext('2d')
  chartInstance.value = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['用户记忆', '核心记忆', '通用知识'],
      datasets: [{
        data: [props.userMemories, props.coreMemories, props.knowledgeMemories],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  })
}

onMounted(() => {
  updateChart()
})

watch([() => props.userMemories, () => props.coreMemories, () => props.knowledgeMemories], () => {
  updateChart()
})
</script>

<style scoped>
.memory-stats {
  margin: 1rem;
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
</style>
