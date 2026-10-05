const fs = require('fs');
const path = require('path');

const source = path.resolve(process.argv[2] || 'tmp/fritzing-parts');
const destination = path.resolve(process.argv[3] || 'hardware-packs/fritzing-core');
const fzpDirectory = path.join(source, 'core');
const svgDirectory = path.join(source, 'svg', 'core', 'breadboard');
if (!fs.existsSync(fzpDirectory) || !fs.existsSync(svgDirectory)) {
  throw new Error('Usage: node scripts/build-fritzing-pack.js <fritzing-parts> <destination>');
}

fs.mkdirSync(path.join(destination, 'images'), { recursive: true });
const text = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() : '';
};
const entries = [];
for (const filename of fs.readdirSync(fzpDirectory).filter(file => file.endsWith('.fzp'))) {
  const xml = fs.readFileSync(path.join(fzpDirectory, filename), 'utf8');
  const imageMatch = xml.match(/<breadboardView>[\s\S]*?<layers\s+image=['"]breadboard\/([^'"]+)['"]/i);
  if (!imageMatch) continue;
  const image = imageMatch[1];
  const imageSource = path.join(svgDirectory, image);
  if (!fs.existsSync(imageSource)) continue;
  const tagsBlock = (xml.match(/<tags>([\s\S]*?)<\/tags>/i) || [,''])[1];
  const tags = [...tagsBlock.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)].map(match => match[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const properties = [...xml.matchAll(/<property\s+name=['"]([^'"]+)['"]>([\s\S]*?)<\/property>/gi)].map(match => `${match[1]} ${match[2].replace(/<[^>]+>/g, ' ')}`);
  const idMatch = xml.match(/moduleId=['"]([^'"]+)['"]/i);
  const connectors = [...xml.matchAll(/<connector\s+([^>]+)>[\s\S]*?<\/connector>/gi)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)=['"]([^'"]*)['"]/g)].map(item => [item[1], item[2]]));
    const body = match[0];
    const name = (body.match(/<name>([\s\S]*?)<\/name>/i) || [,''])[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const description = (body.match(/<description>([\s\S]*?)<\/description>/i) || [,''])[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { id: attrs.id || '', name, description };
  }).filter(connector => connector.id);
  entries.push({
    id: idMatch ? idMatch[1] : path.basename(filename, '.fzp'),
    title: text(xml, 'title'),
    tags,
    family: properties.join(' ').replace(/\s+/g, ' ').trim(),
    image,
    connectors,
    sourceLabel: 'Fritzing Core',
    sourceUrl: 'https://github.com/fritzing/fritzing-parts',
    license: 'CC BY-SA 3.0'
  });
  const output = path.join(destination, 'images', image);
  if (!fs.existsSync(output)) fs.copyFileSync(imageSource, output);
}
entries.sort((a, b) => a.title.localeCompare(b.title, 'en'));
fs.writeFileSync(path.join(destination, 'catalog.json'), JSON.stringify({ formatVersion: 1, source: 'https://github.com/fritzing/fritzing-parts', license: 'CC BY-SA 3.0', generatedAt: new Date().toISOString(), entries }, null, 2));
fs.copyFileSync(path.join(source, 'LICENSE.txt'), path.join(destination, 'LICENSE-FRITZING.txt'));
fs.writeFileSync(path.join(destination, 'README.txt'), `Fritzing Core offline hardware pack\nSource: https://github.com/fritzing/fritzing-parts\nLicense: CC BY-SA 3.0\nCredit: This image was created with Fritzing.\nEntries: ${entries.length}\n`);
console.log(`Built ${entries.length} indexed Fritzing components in ${destination}`);
