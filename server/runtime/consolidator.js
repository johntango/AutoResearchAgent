export const createConsolidator = ({ memoryManager }) => ({
  async run() {
    const semanticMemory = await memoryManager.consolidate();
    return {
      updatedAt: new Date().toISOString(),
      items: semanticMemory.length,
    };
  },
});
