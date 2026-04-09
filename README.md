# A Minimal Learning System

This project is a minimal learning system that keeps the model weights frozen and pushes adaptation into runtime memory, retrieval, and tool use.

## Stack

- JavaScript only
- No classes in app code; runtime modules use function factories
- React client with Vite
- Node.js + Express API
- OpenAI Agents SDK for orchestration
- Local JSON files as the minimal stand-in for vector memory, structured memory, episodic logs, and session state

## Architecture

```text
[ React Client ]
    |
    +--> chat UI
    +--> memory inspection
    +--> tool traces
    +--> evaluation view

[ Node API Server ]
    |
    +--> [ Agent Controller ]
    |         |
    |         +--> [ Memory Manager ]
    |         |         +--> facts.json
    |         |         +--> procedures.json
    |         |         +--> episodes.json
    |         |         +--> semantic-memory.json
    |         |
    |         +--> [ Tool Router ]
    |         |         +--> OpenAI web search tool
    |         |         +--> calculator function tool
    |         |         +--> memory inspection tools
    |         |
    |         +--> [ Model Adapter ]
    |         |         +--> OpenAI Agent + Runner
    |         |
    |         +--> [ Evaluator / Feedback ]
    |         +--> [ Consolidator ]
    |
    +--> [ Session Manager ]
              +--> previousResponseId persistence
```

## Runtime Loop

1. Receive task.
2. Classify task type.
3. Retrieve facts, similar episodes, and relevant procedures.
4. Build a context package.
5. Run an OpenAI agent with tools.
6. Evaluate the result.
7. Write an episode.
8. Consolidate episodes into semantic memory.

## Environment

Set your API key before starting the server:

```bash
export OPENAI_API_KEY=sk-...
```

Runtime requirement:

- Node.js 22 or later

## Install and run

```bash
npm install
npm run dev
```

Server:

- http://localhost:3001

Client:

- http://localhost:5173

## Key files

- `server/index.js`: Express API surface
- `server/runtime/agentController.js`: orchestration loop
- `server/runtime/modelAdapter.js`: OpenAI Agents SDK integration
- `server/runtime/toolRouter.js`: hosted and function tools
- `server/runtime/memoryManager.js`: external memory retrieval and consolidation
- `server/runtime/sessionManager.js`: `previousResponseId` persistence per session
- `client/src/App.jsx`: main dashboard

## Current limitations

- Structured and vector memory are represented with local JSON files for the initial scaffold.
- WebSocket or SSE streaming is not wired yet.
- Auth is not implemented.
- Retrieval is simple lexical ranking rather than embeddings + reranking.
