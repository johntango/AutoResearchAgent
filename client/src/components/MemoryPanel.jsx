const renderItems = (items, empty) => {
  if (!items?.length) {
    return <p className="empty-state">{empty}</p>;
  }

  return items.map((item) => (
    <article key={item.id} className="memory-item">
      <header>
        <span>{item.kind}</span>
        <strong>{item.id}</strong>
      </header>
      <p>{item.summary}</p>
    </article>
  ));
};

export default function MemoryPanel({ memory }) {
  return (
    <section className="panel panel-memory">
      <div className="panel-header">
        <p className="eyebrow">Learning substrate</p>
        <h2>External memory</h2>
      </div>
      <div className="memory-grid">
        <div>
          <h3>Facts</h3>
          {renderItems(memory?.facts, 'No facts stored.')}
        </div>
        <div>
          <h3>Procedures</h3>
          {renderItems(memory?.procedures, 'No procedures stored.')}
        </div>
        <div>
          <h3>Episodes</h3>
          {renderItems(memory?.episodes, 'No episodes stored.')}
        </div>
        <div>
          <h3>Semantic memory</h3>
          {renderItems(memory?.semanticMemory, 'Consolidation has not produced semantic memory yet.')}
        </div>
      </div>
    </section>
  );
}
