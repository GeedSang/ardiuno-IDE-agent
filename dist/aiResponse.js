"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistantText = assistantText;
exports.normalizeModelCode = normalizeModelCode;
exports.extractArduinoCode = extractArduinoCode;
exports.mergeCodeContinuation = mergeCodeContinuation;
function assistantText(choice) {
    if (!choice)
        return '';
    const content = choice.message?.content ?? choice.text;
    if (typeof content === 'string')
        return content.trim();
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string')
                return part;
            if (!part || typeof part !== 'object')
                return '';
            const value = part;
            return typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content : '';
        }).join('').trim();
    }
    return '';
}
function normalizeModelCode(value) {
    return value.trim()
        .replace(/^```(?:cpp|c\+\+|arduino|ino)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/\u00a0/g, ' ')
        .trim();
}
function codeFromJson(text) {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const candidates = [cleaned];
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
        candidates.push(cleaned.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate);
            for (const key of ['code', 'arduino_code', 'source', 'content']) {
                if (typeof value?.[key] === 'string')
                    return normalizeModelCode(value[key]);
            }
        }
        catch { /* Try the next representation. */ }
    }
    return '';
}
function extractArduinoCode(text) {
    const jsonCode = codeFromJson(text);
    if (/\bvoid\s+setup\s*\(/.test(jsonCode) && /\bvoid\s+loop\s*\(/.test(jsonCode))
        return jsonCode;
    const fenced = [...text.matchAll(/```(?:cpp|c\+\+|arduino|ino)?\s*([\s\S]*?)```/gi)]
        .map(match => normalizeModelCode(match[1]))
        .find(code => /\bvoid\s+setup\s*\(/.test(code) && /\bvoid\s+loop\s*\(/.test(code));
    if (fenced)
        return fenced;
    const plain = normalizeModelCode(text);
    return /\bvoid\s+setup\s*\(/.test(plain) && /\bvoid\s+loop\s*\(/.test(plain) ? plain : '';
}
function mergeCodeContinuation(previous, next) {
    const left = normalizeModelCode(previous);
    const right = normalizeModelCode(next);
    if (!left)
        return right;
    if (!right)
        return left;
    if (/\bvoid\s+setup\s*\(/.test(right) && /\bvoid\s+loop\s*\(/.test(right))
        return right;
    const maxOverlap = Math.min(left.length, right.length, 3000);
    for (let size = maxOverlap; size >= 8; size--) {
        if (left.slice(-size) === right.slice(0, size))
            return left + right.slice(size);
    }
    return left + right;
}
//# sourceMappingURL=aiResponse.js.map