// AI provider clients: turns a batch of emails into per-topic summaries.
// Anthropic is the default provider (uses tool-use for structured output);
// OpenAI and Gemini are offered as alternatives, each via their own
// JSON-schema-constrained structured output mode.

const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BODY_CHARS_FOR_PROMPT = 1200;

function buildSystemPrompt(topics) {
  const topicList = topics.map((t) => `- ${t.id}: ${t.name} — ${t.description}`).join('\n');
  return `You organize a user's important emails into topics and write short summaries.

Available topics:
${topicList}
- other: Anything that doesn't clearly fit the topics above.

For each email:
1. Choose the single best-fitting topic id (or "other"). Pick exactly one.
2. Write a summary of at most 2 short sentences that surfaces the single most useful, topic-relevant detail (a date, time, amount, deadline, or action needed). Do not just restate the subject line.
3. Set priority to "high" if it needs action or has a near-term deadline/time, "low" for FYI/promotional content, otherwise "normal".

Return a result for every email id you were given, in the same order you received them.`;
}

function trimForPrompt(email) {
  return {
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    content: (email.bodyExcerpt || email.snippet || '').slice(0, BODY_CHARS_FOR_PROMPT),
  };
}

function validTopicIds(topics) {
  return new Set([...topics.map((t) => t.id), 'other']);
}

function buildResultsSchema(topics) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            topic: { type: 'string', description: `One of: ${[...validTopicIds(topics)].join(', ')}` },
            summary: { type: 'string' },
            priority: { type: 'string', enum: ['high', 'normal', 'low'] },
          },
          required: ['id', 'topic', 'summary', 'priority'],
        },
      },
    },
    required: ['results'],
  };
}

function normalizeResults(results, emails, topics) {
  const allowed = validTopicIds(topics);
  const byId = new Map(emails.map((e) => [e.id, e]));
  const seen = new Set();
  const normalized = [];

  for (const r of results || []) {
    if (!r || !byId.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    normalized.push({
      id: r.id,
      topic: allowed.has(r.topic) ? r.topic : 'other',
      summary: (r.summary || '').trim() || byId.get(r.id).snippet || '',
      priority: ['high', 'normal', 'low'].includes(r.priority) ? r.priority : 'normal',
    });
  }

  // Anything the model skipped still needs a home so it isn't silently dropped.
  for (const email of emails) {
    if (!seen.has(email.id)) {
      normalized.push({
        id: email.id,
        topic: 'other',
        summary: email.snippet || '',
        priority: 'normal',
      });
    }
  }

  return normalized;
}

async function callAnthropic(emails, topics, settings) {
  if (!settings.apiKey) {
    throw new Error('Missing Anthropic API key. Add it in the extension options.');
  }

  const tool = {
    name: 'categorize_emails',
    description: 'Classify each email into a topic and produce a short, specific summary.',
    input_schema: buildResultsSchema(topics),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: buildSystemPrompt(topics),
      tools: [tool],
      tool_choice: { type: 'tool', name: 'categorize_emails' },
      messages: [
        { role: 'user', content: JSON.stringify({ emails: emails.map(trimForPrompt) }) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === 'tool_use' && b.name === 'categorize_emails');
  if (!toolUse) throw new Error('AI response did not include structured results.');
  return normalizeResults(toolUse.input?.results, emails, topics);
}

async function callOpenAI(emails, topics, settings) {
  if (!settings.apiKey) {
    throw new Error('Missing OpenAI API key. Add it in the extension options.');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${buildSystemPrompt(topics)}\n\nRespond with a JSON object of the exact shape {"results": [{"id": "...", "topic": "...", "summary": "...", "priority": "high|normal|low"}]}.`,
        },
        { role: 'user', content: JSON.stringify({ emails: emails.map(trimForPrompt) }) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI response was empty.');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse the AI JSON response.');
  }
  return normalizeResults(parsed.results, emails, topics);
}

async function callGemini(emails, topics, settings) {
  if (!settings.apiKey) {
    throw new Error('Missing Gemini API key. Add it in the extension options.');
  }

  const res = await fetch(`${GEMINI_API_BASE}/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.geminiModel || 'gemini-3.8-flash',
      system_instruction: buildSystemPrompt(topics),
      input: JSON.stringify({ emails: emails.map(trimForPrompt) }),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: buildResultsSchema(topics),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const steps = data.steps || [];
  const modelStep = [...steps].reverse().find((s) => s.type === 'model_output');
  const textPart = modelStep?.content?.find((c) => c.type === 'text');
  if (!textPart?.text) throw new Error('AI response did not include structured results.');

  let parsed;
  try {
    parsed = JSON.parse(textPart.text);
  } catch {
    throw new Error('Could not parse the AI JSON response.');
  }
  return normalizeResults(parsed.results, emails, topics);
}

export async function categorizeAndSummarize(emails, settings) {
  if (emails.length === 0) return [];
  if (settings.provider === 'openai') {
    return callOpenAI(emails, settings.topics, settings);
  }
  if (settings.provider === 'gemini') {
    return callGemini(emails, settings.topics, settings);
  }
  return callAnthropic(emails, settings.topics, settings);
}

export async function testApiKey(settings) {
  if (settings.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI key check failed (HTTP ${res.status}).`);
    return true;
  }

  if (settings.provider === 'gemini') {
    const res = await fetch(`${GEMINI_API_BASE}/models`, {
      headers: { 'x-goog-api-key': settings.apiKey },
    });
    if (!res.ok) throw new Error(`Gemini key check failed (HTTP ${res.status}).`);
    return true;
  }

  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) throw new Error(`Anthropic key check failed (HTTP ${res.status}).`);
  return true;
}
