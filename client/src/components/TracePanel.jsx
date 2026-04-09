export default function TracePanel({ result }) {
  return (
    <section className="panel panel-trace">
      <div className="panel-header">
        <p className="eyebrow">Inspection</p>
        <h2>Plan, tools, evaluation</h2>
      </div>
      <div className="trace-columns">
        <div>
          <h3>Plan</h3>
          <ol>
            {(result?.plan?.steps || []).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Tool traces</h3>
          <ul>
            {(result?.toolResults || []).map((entry) => (
              <li key={`${entry.tool}-${entry.output}`}>
                <strong>{entry.tool}</strong>
                <span>{entry.output}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Evaluation</h3>
          <ul>
            {(result?.evaluation?.checks || []).map((check) => (
              <li key={check.name} className={check.passed ? 'passed' : 'failed'}>
                {check.name}
              </li>
            ))}
          </ul>
          <p className="footnote">
            Consolidated items: {result?.consolidation?.items ?? 0}
          </p>
          <p className="footnote">
            Response ID chain: {result?.sessionId || 'no active session'}
          </p>
          <ul>
            {(result?.sdkItems || []).map((item) => (
              <li key={`${item.id}-${item.type}`}>
                <strong>{item.type}</strong>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
