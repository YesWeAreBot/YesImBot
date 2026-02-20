export interface MemoryBlock {
  label: string;
  title?: string;
  description?: string;
  content: string;
  filename: string;
}

export interface MemoryConfig {
  coreMemoryPath?: string;
  memoryCharLimit?: number;
}
