# cURL examples for search and ask

Base URL: `http://localhost:3001` (or use Next rewrites: `http://localhost:3000/api`)

Replace `YOUR_NOTEBOOK_ID` with a real notebook id (e.g. from `GET /notebooks` with header `X-User-Id: dev-user`).

## GET /search

```bash
# Required: notebookId, q. Optional: k (default 5, max 20)
curl -s "http://localhost:3001/search?notebookId=YOUR_NOTEBOOK_ID&q=keyword&k=5"
```

Example response:
```json
{
  "items": [
    {
      "chunkId": "chunk-...",
      "sourceId": "src-...",
      "segmentId": "seg-...",
      "pageOrIndex": 1,
      "snippet": "...",
      "text": "full chunk text..."
    }
  ]
}
```

## POST /ask

Requires `OPENROUTER_API_KEY` in env. Creates a new conversation and two messages (user + assistant) with message_citations.

```bash
curl -s -X POST "http://localhost:3001/ask" \
  -H "Content-Type: application/json" \
  -d '{"notebookId":"YOUR_NOTEBOOK_ID","question":"What is the main topic?","topK":6}'
```

Example response:
```json
{
  "answer": "The main topic is ... [C1][C2].",
  "citations": [
    {
      "chunkId": "chunk-...",
      "sourceId": "src-...",
      "pageOrIndex": 1,
      "snippet": "..."
    }
  ]
}
```

## Via Next rewrites (same origin)

If the app is behind Next at `http://localhost:3000`:

```bash
curl -s "http://localhost:3000/api/search?notebookId=YOUR_NOTEBOOK_ID&q=keyword&k=5"
curl -s -X POST "http://localhost:3000/api/ask" \
  -H "Content-Type: application/json" \
  -d '{"notebookId":"YOUR_NOTEBOOK_ID","question":"What is the main topic?"}'
```
