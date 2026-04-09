const scoreText = (source, query) => {
  const sourceTokens = source.toLowerCase().split(/\W+/).filter(Boolean);
  const queryTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  return queryTokens.reduce((total, token) => total + (sourceTokens.includes(token) ? 1 : 0), 0);
};

const rankEntries = (entries, query) =>
  entries
    .map((entry) => ({
      ...entry,
      score: scoreText(`${entry.summary} ${entry.detail ?? ''}`, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

export const createMemoryManager = ({ store }) => ({
  async retrieve(task) {
    const facts = await store.readJson('facts.json', [
      {
        id: 'fact-architecture',
        kind: 'fact',
        summary: 'The system uses a three-layer architecture with React UI, Express API, and external memory.',
        detail: 'The learning substrate uses vector, structured, and episodic memory instead of fine-tuning.',
      },
    ]);

    const procedures = await store.readJson('procedures.json', [
      {
        id: 'procedure-runtime-loop',
        kind: 'procedure',
        summary: 'Runtime loop retrieves memory, generates a plan, runs tools, evaluates, and writes an episode.',
      },
    ]);

    const episodes = await store.readJson('episodes.json', []);

    return {
      facts: rankEntries(facts, task.input),
      procedures: rankEntries(procedures, task.input),
      episodes: rankEntries(episodes, task.input),
    };
  },

  async inspect() {
    const [facts, procedures, episodes, semanticMemory] = await Promise.all([
      store.readJson('facts.json', []),
      store.readJson('procedures.json', []),
      store.readJson('episodes.json', []),
      store.readJson('semantic-memory.json', []),
    ]);

    return {
      facts,
      procedures,
      episodes,
      semanticMemory,
    };
  },

  async writeEpisode(episode) {
    const episodes = await store.readJson('episodes.json', []);
    const nextEpisodes = [episode, ...episodes].slice(0, 50);
    await store.writeJson('episodes.json', nextEpisodes);
    return episode;
  },

  async consolidate() {
    const episodes = await store.readJson('episodes.json', []);
    const semanticMemory = episodes.slice(0, 10).map((episode) => ({
      id: `semantic-${episode.id}`,
      kind: 'semantic',
      summary: episode.summary,
      sourceEpisodeId: episode.id,
    }));
    await store.writeJson('semantic-memory.json', semanticMemory);
    return semanticMemory;
  },
});
