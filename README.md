# Document Reformatting Agent Prototype

Production-style prototype of a supervisor-orchestrated document-reformatting agent system built with Node.js, Express, plain JavaScript, and the latest OpenAI Agents SDK.

## What It Does

The API accepts:

- `target.docx`: style and format exemplar
- `submitted.docx`: content source of truth

The system runs a graph of collaborating agents over shared workflow state and produces:

- output document artifact path (`outputFormatted.docx`)
- `template_profile.json`
- `content_map.json`
- `transformation_plan.json`
- `qa_report.json`
- `review_items.json`
- full execution trace and supervisor decision log

This prototype simulates DOCX parsing and rebuilding honestly. The architecture is real, the reasoning/orchestration path is SDK-backed, and the document extraction/rebuild logic is intentionally partial: the current rebuilder emits a real `.docx` artifact by copying the submitted DOCX package to the workflow output path while the JSON rebuild summary captures the intended structural/style overlay. Full template-driven DOCX rewriting can replace this step later.

## Why A Graph Instead Of A Linear Chain

Document reformatting is not a single-pass problem. A linear pipeline cannot represent:

- low-confidence source analysis that needs re-analysis
- invalid transformation plans that must loop back to mapping or analysis
- QA failures that should trigger targeted repairs and rebuilds
- bounded retries and escalation to manual review

This project uses a supervisor-driven state machine with a shared blackboard state so agents can collaborate through stable artifacts instead of hidden control flow. The reasoning layer uses `@openai/agents` and deterministic fallbacks are preserved for tests and offline execution.

## Agent Graph

Agents:

1. `templateProfiler`
2. `sourceAnalyzer`
3. `structureMapper`
4. `planValidator`
5. `documentRebuilder`
6. `qaValidator`
7. `repairAgent`
8. `exceptionHandler`
9. `supervisor`

SDK-backed reasoning paths:

- supervisor routing decision refinement
- structure mapping refinement
- plan validation refinement
- QA review refinement
- repair directive generation

High-level flow:

1. load target and submitted metadata
2. profile template style rules
3. analyze submitted semantic structure
4. map structure into a transformation plan
5. validate the plan
6. rebuild a placeholder formatted artifact
7. QA the rebuilt result
8. repair and rebuild when possible
9. escalate when ambiguity or retries exceed thresholds

## Retry Model

Bounded loops:

1. Loop A: source analysis retry when analysis confidence is too low
2. Loop B: mapper/analyzer retry when plan validation fails
3. Loop C: repair plus rebuild retry when QA fails but is repairable
4. Loop D: escalation path when ambiguity remains or retries are exhausted

Retry limits are centralized in [src/utils/constants.js](src/utils/constants.js).

## Escalation Model

The supervisor escalates when:

- required input files are invalid or missing
- confidence stays below threshold after retries
- plan validation repeatedly fails
- QA failures are not repairable
- repair agent cannot propose concrete fixes
- supervisor safety loop limit is exceeded

Escalation produces structured review items through the exception handler.

## Shared State Model

Each workflow maintains a shared state object with:

- run metadata
- file paths
- artifacts
- confidence scores
- retry counters
- issues
- trace entries
- supervisor decisions
- escalation flags

See [src/models/workflowState.js](src/models/workflowState.js).

## Folder Structure

```text
src/
	app.js
	server.js
	routes/
		workflowRoutes.js
		healthRoutes.js
	controllers/
		workflowController.js
	services/
		supervisor.js
		stateStore.js
		trace.js
	agents/
		templateProfiler.js
		sourceAnalyzer.js
		structureMapper.js
		planValidator.js
		documentRebuilder.js
		qaValidator.js
		repairAgent.js
		exceptionHandler.js
	utils/
		constants.js
		docxSimulation.js
		fileUtils.js
		id.js
		logger.js
		stateHelpers.js
	models/
		workflowState.js
	output/
	middleware/
		errorHandler.js
		notFound.js
scripts/
	generateExamples.js
tests/
	workflow.test.js
examples/
```

## Install

```bash
npm install
```

Requirements:

- Node.js 22+
- `OPENAI_API_KEY` for live OpenAI Agents SDK runs

Without `OPENAI_API_KEY`, the system falls back to deterministic local logic so tests and example scripts still run.

## Run Locally

```bash
npm start
```

Server starts on `PORT` from `.env` or `3001`.

Health check:

```bash
curl http://localhost:3001/api/health
```

## Run A Workflow

```bash
curl -X POST http://localhost:3001/api/workflows/run \
	-H "Content-Type: application/json" \
	-d '{
		"targetPath": "/absolute/path/to/target.docx",
		"submittedPath": "/absolute/path/to/submitted.docx"
	}'
```

Optional endpoints:

```bash
curl http://localhost:3001/api/workflows/<runId>
curl http://localhost:3001/api/workflows/<runId>/trace
```

## API Response Shape

Typical workflow response:

```json
{
  "runId": "run_...",
  "status": "DONE",
  "success": true,
  "files": {
    "targetPath": "...",
    "submittedPath": "...",
    "outputPath": "..."
  },
  "artifacts": {
    "templateProfile": {},
    "contentMap": {},
    "transformationPlan": {},
    "qaReport": {},
    "reviewItems": []
  },
  "confidence": {},
  "retries": {},
  "issues": [],
  "trace": [],
  "decisions": [],
  "escalation": {
    "required": false,
    "reasons": []
  }
}
```

## Output Artifacts

Each run writes artifacts into `src/output/<runId>/`:

- `template_profile.json`: the analyzed description of `target.docx`, including inferred conference flavor, style signals, style inventory, and required vs optional document structures.
- `content_map.json`: the extracted semantic view of `submitted.docx`, including title, authors, affiliations, abstract, keywords, sections, lists, tables, figures, references, and front-matter presence flags.
- `transformation_plan.json`: the planned mapping from submitted content into target structure, including section order, heading policy, caption policy, reference policy, front-matter policy, block plan, and repair history.
- `qa_report.json`: the final QA verdict for the run, including pass/fail status, repairability, checks, issue count, confidence, and any normalized issues used by the supervisor.
- `review_items.json`: escalation or manual-review items generated when the workflow cannot safely finish automatically.
- `trace.json`: the chronological execution trace across agents, including per-step inputs, outputs, issues, confidence, and routing decisions.
- `outputFormatted.json`: the rebuild summary for the produced document, including ordered blocks, overlay strategy, formatting summary, style policy context, and output artifact metadata.
- `outputFormatted.docx`: the rebuilt document artifact intended to reflect submitted content in target formatting.

## Artifact Semantics

The JSON artifacts are deliberately separated by responsibility:

- `template_profile.json` answers: "What does the target template look like?"
- `content_map.json` answers: "What content and structure exist in the submitted document?"
- `transformation_plan.json` answers: "How should submitted content be rearranged and styled to match the target?"
- `outputFormatted.json` answers: "What did the rebuilder actually attempt and what formatting overlay was applied?"
- `qa_report.json` answers: "Did the rebuilt output pass validation, and if not, why?"
- `review_items.json` answers: "What needs human attention if the workflow escalates?"
- `trace.json` answers: "How did the workflow arrive at its result step by step?"

## Where Font Sizes And Run Styles Come From

There are two separate layers in the current implementation:

1. semantic style names used by the workflow
2. actual OOXML formatting values used by the DOCX rebuilder

### Semantic Style Names

The workflow keeps a semantic inventory of target style names in [src/agents/templateProfiler.js](src/agents/templateProfiler.js).

Examples include:

- `titleStyle`
- `authorStyle`
- `abstractStyle`
- `heading1Style`
- `heading2Style`
- `referenceStyle`

These names are used by the planner and QA layers to describe the target template at a logical level. They do not contain the real numeric font size or direct bold/italic flags.

### Actual Font Sizes, Bold, Italic, And Fonts

The real formatting values come from the OOXML inside `target.docx`, primarily from `word/styles.xml` and from run properties (`w:rPr`) on exemplar paragraphs and runs.

In OOXML, the important run-level fields are typically:

- `w:sz` for font size
- `w:b` for bold
- `w:i` for italic
- `w:rFonts` for font family

Those values are applied in [src/utils/docxStyleOverlay.js](src/utils/docxStyleOverlay.js).

Important functions:

- `copyStyleEntries(...)`: copies style definitions from `target.docx` into the rebuilt package
- `replaceRunProperties(...)`: copies a source run's `w:rPr` into an output run
- `setRunPropertiesFromStyle(...)`: applies style-based run properties from the target style definition
- `applyParagraphFormatting(...)`: applies paragraph properties and exemplar run formatting to output content

So the practical split is:

- `templateProfiler` defines which named styles the workflow thinks matter
- `docxStyleOverlay` reads and applies the actual formatting values from `target.docx`

This is why changing a target template's actual font size or bold/italic behavior is primarily an OOXML/style-definition concern, not a change to the semantic JSON artifacts.

## Tests

Run the built-in tests:

```bash
npm test
```

Covered scenarios:

1. successful workflow completion
2. plan validation failure looping back to source analysis
3. QA failure entering repair loop and recovering
4. escalation after retries are exhausted

## Example Trace Files

Generate example workflow outputs:

```bash
npm run examples
```

This writes:

- [examples/successful-workflow.json](examples/successful-workflow.json)
- [examples/escalated-workflow.json](examples/escalated-workflow.json)

## Where To Plug In Real DOCX Logic Later

The interface boundaries are already in place:

1. Replace simulated template profiling in [src/agents/templateProfiler.js](src/agents/templateProfiler.js)
2. Replace simulated source extraction in [src/agents/sourceAnalyzer.js](src/agents/sourceAnalyzer.js)
3. Replace placeholder rebuild output in [src/agents/documentRebuilder.js](src/agents/documentRebuilder.js)
4. Strengthen QA in [src/agents/qaValidator.js](src/agents/qaValidator.js)

## OpenAI Agents SDK Usage

The project uses the latest published `@openai/agents` package and centralizes SDK integration in [src/services/openaiAgents.js](src/services/openaiAgents.js).

Current SDK usage patterns:

1. `Agent` + `run()` for structured specialist reasoning
2. Zod output schemas for structured results
3. Supervisor decision refinement constrained by allowed next actions
4. Deterministic fallback behavior when SDK calls are unavailable or disabled
   The supervisor, shared state model, retry routing, trace logging, and escalation behavior can remain stable while those internals become real.
