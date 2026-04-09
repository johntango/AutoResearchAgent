const asJson = async (response) => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }

  return response.json();
};

export const fetchMemory = async () => {
  const response = await fetch('/api/memory');
  return asJson(response);
};

export const sendChat = async ({ input, sessionId }) => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, sessionId }),
  });

  return asJson(response);
};
