// Minimal tool-calling agent loop against any OpenAI-compatible Chat Completions endpoint
// (LM Studio, Ollama, vLLM, OpenRouter, ...). The model sees MCP tools as functions; every
// call goes to the real MCP server over stdio.

const MAX_TOOL_RESULT_CHARS = 30_000;

function toFunction(tool) {
  const { $schema: _ignored, ...parameters } = tool.inputSchema ?? { type: 'object', properties: {} };
  return { type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters } };
}

async function chat({ baseUrl, apiKey, model, messages, tools, temperature }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, tools, temperature }),
  });
  if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

/**
 * Runs one case. Returns the final answer, every tool call with its result, token usage and timing.
 * @param {{ client: import('@modelcontextprotocol/client').Client, system: string, prompt: string,
 *           llm: { baseUrl: string, apiKey?: string, model: string, temperature?: number }, maxSteps?: number }} opts
 */
export async function runAgent({ client, system, prompt, llm, maxSteps = 15 }) {
  const { tools } = await client.listTools();
  const functions = tools.map(toFunction);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];
  const calls = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const started = Date.now();

  for (let step = 0; step < maxSteps; step++) {
    const response = await chat({ ...llm, temperature: llm.temperature ?? 0, messages, tools: functions });
    usage.prompt_tokens += response.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += response.usage?.completion_tokens ?? 0;
    const msg = response.choices?.[0]?.message;
    if (!msg) throw new Error(`Malformed LLM response: ${JSON.stringify(response).slice(0, 300)}`);
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { answer: msg.content ?? '', calls, usage, ms: Date.now() - started, steps: step + 1 };
    }
    for (const tc of msg.tool_calls) {
      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = { _unparseable: tc.function.arguments };
      }
      const result = await client.callTool({ name: tc.function.name, arguments: args });
      const payload = result.structuredContent ?? result.content;
      calls.push({ name: tc.function.name, args, result: payload, isError: Boolean(result.isError) });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }
  return { answer: '', calls, usage, ms: Date.now() - started, steps: maxSteps, error: 'max steps reached' };
}
