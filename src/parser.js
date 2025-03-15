const fs = require('fs-extra');

function parseSchema(filePath) {
  console.log('🔍 Parsing schema.orm...');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));

  let datasource = null;
  const models = [];
  let currentModel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('datasource')) {
      const datasourceLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('}')) {
        datasourceLines.push(lines[i]);
        i++;
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

  // Gabungin parts buat nangani spasi di @default
  const fullDefinition = definition.trim();
  const defaultMatch = fullDefinition.match(/@default\((.*?)\)/);
  if (defaultMatch) {
    let defaultValue = defaultMatch[1];
    if (defaultValue.startsWith('"') && defaultValue.endsWith('"')) {
      defaultValue = defaultValue.slice(1, -1); // Hilangin kutipan luar
    }
    field.default = defaultValue;
  }

  for (const part of parts.slice(1)) {
    if (part === '@id') field.isId = true;
    if (part === '@unique') field.isUnique = true;
    if (part === '?') field.isOptional = true;
    if (part === '@updatedAt') field.isUpdatedAt = true;
    if (part.startsWith('@references')) {
      const refMatch = part.match(/@references\((.*?)\)/);
      if (refMatch) field.references = refMatch[1];
    }
    if (part.startsWith('@onDelete')) {
      const onDeleteMatch = part.match(/@onDelete\((.*?)\)/);
      if (onDeleteMatch) field.onDelete = onDeleteMatch[1];
    }
  }

  return field;
}

module.exports = { parseSchema };