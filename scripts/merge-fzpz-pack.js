const fs = require('fs');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

const sourceDirectory = path.resolve(process.argv[2] || '.');
const destination = path.resolve(process.argv[3] || 'hardware-packs/fritzing-core');
const sourceLabel = process.argv[4] || 'Fritzing community library';
const sourceUrl = process.argv[5] || '';
const license = process.argv[6] || 'CC BY-SA 3.0';
const catalogPath = path.join(destination, 'catalog.json');
if (!fs.existsSync(catalogPath)) throw new Error(`Missing base catalog: ${catalogPath}`);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
catalog.entries = Array.isArray(catalog.entries) ? catalog.entries : [];
const existing = new Set(catalog.entries.map(entry => `${entry.sourceLabel || 'core'}:${entry.id}`));
const cleanText = value => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const first = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? cleanText(match[1]) : '';
};
let added = 0;
for (const filename of fs.readdirSync(sourceDirectory).filter(file => file.toLowerCase().endsWith('.fzpz'))) {
  try {
    const zip = unzipSync(new Uint8Array(fs.readFileSync(path.join(sourceDirectory, filename))));
    const partKey = Object.keys(zip).find(key => /(?:^|\/)part\..+\.fzp$/i.test(key)) || Object.keys(zip).find(key => /\.fzp$/i.test(key));
    if (!partKey) continue;
    const xml = strFromU8(zip[partKey]);
    const imageMatch = xml.match(/<breadboardView>[\s\S]*?<layers\s+image=['"]breadboard\/([^'"]+)['"]/i);
    if (!imageMatch) continue;
    const upstreamImage = imageMatch[1];
    const imageKey = Object.keys(zip).find(key => key.toLowerCase().endsWith(`breadboard.${upstreamImage}`.toLowerCase())) || Object.keys(zip).find(key => key.toLowerCase().endsWith(upstreamImage.toLowerCase()));
    if (!imageKey) continue;
    const idMatch = xml.match(/moduleId=['"]([^'"]+)['"]/i);
    const id = idMatch ? idMatch[1] : path.basename(filename, '.fzpz');
    if (existing.has(`${sourceLabel}:${id}`)) continue;
    const tagsBlock = (xml.match(/<tags>([\s\S]*?)<\/tags>/i) || [,''])[1];
    const tags = [...tagsBlock.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)].map(match => cleanText(match[1])).filter(Boolean);
    const properties = [...xml.matchAll(/<property\s+name=['"]([^'"]+)['"]>([\s\S]*?)<\/property>/gi)].map(match => cleanText(`${match[1]} ${match[2]}`));
    const safeImage = `${sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.replace(/[^a-zA-Z0-9._-]+/g, '-')}.svg`;
    fs.writeFileSync(path.join(destination, 'images', safeImage), Buffer.from(zip[imageKey]));
    catalog.entries.push({ id, title: first(xml, 'title'), tags, family: properties.join(' '), image: safeImage, sourceLabel, sourceUrl, license });
    existing.add(`${sourceLabel}:${id}`);
    added++;
  } catch (error) {
    console.warn(`Skipped ${filename}: ${error.message}`);
  }
}
catalog.generatedAt = new Date().toISOString();
catalog.entries.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'en'));
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(`Merged ${added} components from ${sourceLabel}; catalog now has ${catalog.entries.length} entries`);

