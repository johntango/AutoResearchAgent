export default function ChatPanel({
  input,
  setInput,
  responseMode,
  setResponseMode,
  onSubmit,
  loading,
  result,
}) {
  return (
    <section className="panel panel-chat">
      <div className="panel-header">
        <p className="eyebrow">Runtime loop</p>
        <h2>Chat and orchestration</h2>
      </div>
      <form className="chat-form" onSubmit={onSubmit}>
        <div className="mode-toggle" role="group" aria-label="Response mode">
          <button
            type="button"
            className={responseMode === 'concise' ? 'toggle-active' : ''}
            onClick={() => setResponseMode('concise')}
          >
            Concise
          </button>
          <button
            type="button"
            className={responseMode === 'detailed' ? 'toggle-active' : ''}
            onClick={() => setResponseMode('detailed')}
          >
            Detailed
          </button>
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the agent to reason, research, or calculate."
          rows={5}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Running...' : 'Run agent'}
        </button>
      </form>
      <div className="response-card">
        <h3>Latest response</h3>
        <pre>{result?.response?.answer || 'No response yet.'}</pre>
      </div>
    </section>
  );
}
