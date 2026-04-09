import { useEffect, useState } from 'react';
import ChatPanel from './components/ChatPanel.jsx';
import MemoryPanel from './components/MemoryPanel.jsx';
import TracePanel from './components/TracePanel.jsx';
import { fetchMemory, sendChat } from './lib/api.js';

const starterPrompt = 'Research how episodic memory should be stored in this system.';

export default function App() {
  const [input, setInput] = useState(starterPrompt);
  const [memory, setMemory] = useState(null);
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadMemory = async () => {
      try {
        setMemory(await fetchMemory());
      } catch (loadError) {
        setError(loadError.message);
      }
    };

    loadMemory();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const nextResult = await sendChat({ input, sessionId: sessionId || undefined });
      setResult(nextResult);
      setSessionId(nextResult.sessionId);
      setMemory(await fetchMemory());
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Minimal learning system</p>
        <h1>Weight-frozen agent with external memory and runtime adaptation</h1>
        <p className="hero-copy">
          This scaffold keeps the language model frozen and pushes learning into retrieval,
          episodic logging, structured memory, lightweight consolidation, and an OpenAI
          Agents SDK runtime.
        </p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="dashboard-grid">
        <ChatPanel
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          loading={loading}
          result={result}
        />
        <TracePanel result={result} />
      </div>

      <MemoryPanel memory={memory} />
    </main>
  );
}
