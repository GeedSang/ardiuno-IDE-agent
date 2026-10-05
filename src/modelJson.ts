function appendMissingJsonClosers(value: string): string {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') stack.push('}');
    else if (character === '[') stack.push(']');
    else if ((character === '}' || character === ']') && stack[stack.length - 1] === character) stack.pop();
  }
  return quoted ? value : value + stack.reverse().join('');
}

function repairJsonPunctuation(input: string): string {
  let value = input.replace(/^\uFEFF/, '').replace(/,\s*([}\]])/g, '$1');
  for (let attempt = 0; attempt < 12; attempt++) {
    try { JSON.parse(value); return value; } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const positionMatch = message.match(/position\s+(\d+)/i);
      if (/Unexpected end of JSON input/i.test(message)) {
        const closed = appendMissingJsonClosers(value);
        if (closed === value) break;
        value = closed;
        continue;
      }
      if (!positionMatch) break;
      const position = Number(positionMatch[1]);
      if (!Number.isInteger(position) || position < 0 || position > value.length) break;
      if (/Expected ',' or '[}\]]' after (?:array element|property value)/i.test(message)) {
        if (position >= value.trimEnd().length) {
          const closed = appendMissingJsonClosers(value);
          if (closed === value) break;
          value = closed;
          continue;
        }
        value = `${value.slice(0, position)},${value.slice(position)}`;
        continue;
      }
      if (/Expected property name or '}'/i.test(message)) {
        const before = value.slice(0, position);
        const comma = before.lastIndexOf(',');
        if (comma >= 0 && /^\s*$/.test(before.slice(comma + 1))) {
          value = `${value.slice(0, comma)}${value.slice(comma + 1)}`;
          continue;
        }
      }
      break;
    }
  }
  return value;
}

export function parseModelJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 ? cleaned.slice(start, end > start ? end + 1 : undefined) : cleaned;
  try { return JSON.parse(repairJsonPunctuation(candidate)); } catch {
    throw new Error('AI 返回的 JSON 格式不完整，自动标点修复未成功');
  }
}
