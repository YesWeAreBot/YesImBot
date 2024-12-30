<template>
  <div>
    <canvas ref="chart"></canvas>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, watch } from 'vue';
import Chart from 'chart.js/auto';

const props = defineProps<{
  data: Array<{ tag: string; count: number }>;
}>();

const chart = ref<HTMLCanvasElement>();

onMounted(() => {
  renderChart();
});

watch(props.data, () => {
  renderChart();
});

const renderChart = () => {
  if (!chart.value) return;

  const ctx = chart.value.getContext('2d');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'pie',
    data: {
      labels: props.data.map((item) => item.tag),
      datasets: [
        {
          data: props.data.map((item) => item.count),
          backgroundColor: [
            '#FF6384',
            '#36A2EB',
            '#FFCE56',
            '#4BC0C0',
            '#9966FF',
          ],
        },
      ],
    },
  });
};
</script>
