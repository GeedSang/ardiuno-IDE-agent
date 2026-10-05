export type LibraryCandidate = { name: string; headers: string[]; architectures: string[]; license?: string; website?: string };
export type InstalledLibrary = { name: string; version: string; license: string; website?: string };

export function parseInstalledLibraries(json: string): InstalledLibrary[] {
  try {
    const payload = JSON.parse(json) as { installed_libraries?: Array<{ library?: Record<string, unknown> }> };
    return (payload.installed_libraries || []).map(item => item.library || {}).map(library => ({
      name: typeof library.name === 'string' ? library.name.trim() : '',
      version: typeof library.version === 'string' ? library.version.trim() : '未知版本',
      license: typeof library.license === 'string' && !/^unspecified$/i.test(library.license) ? library.license.trim() : '许可证未声明',
      website: typeof library.website === 'string' ? library.website.trim() : undefined
    })).filter(item => item.name);
  } catch { return []; }
}

const builtinHeaders = new Set([
  'Arduino.h', 'Wire.h', 'SPI.h', 'EEPROM.h', 'SoftwareSerial.h'
].map(value => value.toLowerCase()));

export function extractExternalHeaders(code: string): string[] {
  const headers: string[] = [];
  const pattern = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const header = match[1].trim();
    if (header && !builtinHeaders.has(header.toLowerCase()) && !headers.some(item => item.toLowerCase() === header.toLowerCase())) headers.push(header);
  }
  return headers;
}

export function parseLibraryCandidates(json: string): LibraryCandidate[] {
  try {
    const payload = JSON.parse(json) as { libraries?: Array<Record<string, unknown>> };
    return (payload.libraries || []).map(item => {
      const latest = item.latest && typeof item.latest === 'object' ? item.latest as Record<string, unknown> : {};
      return {
        name: typeof item.name === 'string' ? item.name.trim() : '',
        headers: Array.isArray(latest.provides_includes) ? latest.provides_includes.map(String) : [],
        architectures: Array.isArray(latest.architectures) ? latest.architectures.map(String) : [],
        license: typeof latest.license === 'string' ? latest.license.trim() : typeof item.license === 'string' ? item.license.trim() : undefined,
        website: typeof latest.website === 'string' ? latest.website.trim() : typeof item.website === 'string' ? item.website.trim() : undefined
      };
    }).filter(item => item.name);
  } catch {
    return [];
  }
}

export function chooseLibraryForHeader(header: string, candidates: LibraryCandidate[], fqbn: string): string | undefined {
  const architecture = fqbn.split(':')[1]?.toLowerCase() || '';
  const exact = candidates.filter(candidate => candidate.headers.some(item => item.toLowerCase() === header.toLowerCase()));
  const compatible = exact.filter(candidate => !candidate.architectures.length || candidate.architectures.includes('*') || candidate.architectures.some(item => item.toLowerCase() === architecture));
  const stem = header.replace(/\.h(?:pp)?$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const nameMatches = candidates.filter(candidate => candidate.name.replace(/[^a-z0-9]/gi, '').toLowerCase() === stem);
  const pool = compatible.length ? compatible : exact.length ? exact : nameMatches;
  return pool.sort((a, b) => {
    const score = (candidate: LibraryCandidate): number => {
      const name = candidate.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
      return (name === stem ? 100 : name.includes(stem) || stem.includes(name) ? 50 : 0) + (candidate.architectures.includes('*') ? 2 : 0);
    };
    return score(b) - score(a) || a.name.localeCompare(b.name);
  })[0]?.name;
}

export function chooseLibraryByNameSimilarity(header: string, candidates: LibraryCandidate[], fqbn: string): string | undefined {
  const architecture = fqbn.split(':')[1]?.toLowerCase() || '';
  const compatible = candidates.filter(candidate => !candidate.architectures.length || candidate.architectures.includes('*') || candidate.architectures.some(item => item.toLowerCase() === architecture));
  const pool = compatible.length ? compatible : candidates;
  const stem = header.replace(/^.*[\\/]/, '').replace(/\.h(?:pp)?$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const commonPrefix = (left: string, right: string): number => {
    let count = 0;
    while (count < left.length && count < right.length && left[count] === right[count]) count++;
    return count;
  };
  const ranked = pool.map(candidate => {
    const name = candidate.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const prefix = commonPrefix(stem, name);
    const score = prefix * 4 + (name.includes(stem) || stem.includes(name) ? 30 : 0) + (/u$/i.test(stem) && /unified/i.test(candidate.name) ? 20 : 0);
    return { name: candidate.name, score };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked[0] && ranked[0].score >= 12 ? ranked[0].name : undefined;
}
