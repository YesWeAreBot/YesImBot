<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface Props {
    current: number
    total: number
    name: string
    size?: number
    strokeWidth?: number
    color?: string
    bgColor?: string
}

const props = withDefaults(defineProps<Props>(), {
    size: 120,
    strokeWidth: 10,
    color: '#4f46e5', // Tailwind indigo-600
    bgColor: '#e0e7ff' // Tailwind indigo-100
})

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const progress = computed(() => (props.current / props.total) * 100)
const strokeDashoffset = computed(() => circumference.value - (progress.value / 100) * circumference.value)

const isMounted = ref(false)

onMounted(() => {
    setTimeout(() => {
        isMounted.value = true
    }, 100)
})
</script>

<template>
    <div class="flex flex-col items-center justify-center p-4 rounded-xl bg-white dark:bg-gray-800 shadow-md transition-all duration-300 hover:shadow-md"
        :style="{ width: `${size}px`, height: `${size + 40}px` }">
        <!-- SVG 圆环进度条 -->
        <div class="relative">
            <svg :width="size" :height="size" class="w-full h-full transform -rotate-90">
                <!-- 背景圆环 -->
                <circle class="text-gray-200 dark:text-gray-600" :cx="size / 2" :cy="size / 2" :r="radius"
                    :stroke-width="strokeWidth" stroke-linecap="round" fill="transparent" :stroke="bgColor" />
                <!-- 进度圆环 -->
                <circle class="text-indigo-600 dark:text-indigo-400 transition-all duration-500 ease-out" :cx="size / 2" :cy="size / 2" :r="radius"
                    :stroke-width="strokeWidth + 1" stroke-linecap="round" fill="transparent" :stroke="color"
                    :stroke-dasharray="circumference"
                    :stroke-dashoffset="isMounted ? strokeDashoffset : circumference" />
            </svg>

            <!-- 中心数字 -->
            <div class="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-gray-200">
                {{ current }}
                <span class="text-sm text-white-600">/</span>
                {{ total }}
            </div>
        </div>

        <!-- 底部名称 -->
        <div class="mt-2 text-gray-200">
            {{ name }}
        </div>
    </div>
</template>
