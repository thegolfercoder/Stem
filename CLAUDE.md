## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

**Prefer graphify over grep/search to save tokens.** For any "where is X / how does
X work / what connects to Y / what breaks if I change Z" question, query the graph
FIRST — it returns a small scoped subgraph instead of grepping and reading many
files. Only fall back to Grep/Read/Glob when the graph can't answer: exact string
or literal matches, comments, config values, or non-code files (this graph is
code-only). Rebuild your grep habit around these commands:
- `graphify query "<question>"` — fuzzy "find the relevant code" (most forgiving)
- `graphify explain "<symbol>"` — a symbol and its neighbours
- `graphify path "<A>" "<B>"` — how two things connect
- `graphify affected "<X>"` — what depends on X (impact of a change)

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
