<template>
    <template v-if="current.name === 'yesimbot-webui'">

        <h2 class="k-schema-header">
            机器人
        </h2>

        <div class="flex flex-wrap justify-center gap-4 p-4">
            <CircularProgress :current="currentValue" :total="totalValue" name="完成率" />
            <CircularProgress :current="currentValue" :total="totalValue" name="进度" />

            <Card :current="currentValue" :total="totalValue" tag="out" name="Token用量" />
            <Card :current="currentValue" :total="totalValue" tag="in" name="Token用量" />
        </div>
    </template>
</template>

<script setup lang="ts">
import { inject, ref } from 'vue';
import Card from '../components/Card.vue';
import CircularProgress from '../components/CircularProgress.vue';


const current: any = inject('manager.settings.current')

const currentValue = ref(0)
const totalValue = 100

const timer = setInterval(() => {
    currentValue.value = (currentValue.value + 1) % totalValue
}, 50)

</script>

<style scoped lang="scss"></style>