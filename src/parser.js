const fs = require('fs-extra');

function parseSchema(filePath) {
  console.log('🔍 Parsing schema.orm...');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));

  let datasource = null;
  const models = [];
  let currentModel = null;

  for (const line of lines) {
    if (line.startsWith('datasource')) {
      const datasourceLines = [];
      let nextLine = lines[lines.indexOf(line) + 1];
      while (nextLine && !nextLine.startsWith('}')) {
        datasourceLines.push(nextLine);
        nextLine = lines[lines.indexOf(nextLine) + 1];
      }
      datasource = parseDataSource(datasourceLines);
    } else if (line.startsWith('model')) {
      currentModel = { name: line.split(' ')[1], fields: {} };
      models.push(currentModel);
    } else if (currentModel && !line.includes('{') && !line.includes('}')) {
      const [name, ...rest] = line.split(/\s+/);
      currentModel.fields[name] = parseField(rest.join(' '));
    }
  }

  console.log('✅ Schema parsed:', { datasource: datasource.url, models: models.map(m => m.name) });
  return { datasource, models };
}

function parseDataSource(lines) {
  const datasource = {};
  for (const line of lines) {
    const [key, value] = line.split('=').map(s => s.trim().replace(/"/g, ''));
    if (key === 'provider') datasource.provider = value;
    if (key === 'url') datasource.url = value;
    if (key === 'ssl') datasource.ssl = value;
  }
  return datasource;
}

function parseField(definition) {
  const parts = definition.split(' ').filter(Boolean);
  const field = { type: parts[0] };
  for (const part of parts.slice(1)) {
    if (part === '@id') field.isId = true;
    if (part === '@unique') field.isUnique = true;
    if (part === '?') field.isOptional = true;
    if (part.startsWith('@default')) field.default = part.match(/\((.*)\)/)?.[1];
  }
  return field;
}

module.exports = { parseSchema };