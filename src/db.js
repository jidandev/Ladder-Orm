const knex = require('knex');
const fs = require('fs');
require('dotenv').config();

let db;

function initDatabase(datasource) {
  if (!db) {
    
    let sslConfig = false;
    if (datasource.ssl) {
      try {
        const caPemBase64 = process.env.CA_PEM;
        if (!caPemBase64) {
          throw new Error('CA_PEM environment variable not set');
        }
        const caPem = Buffer.from(caPemBase64, 'base64').toString('utf8');
        sslConfig = { ca: caPem, rejectUnauthorized: false };
        console.log('🔒 Loaded SSL certificate from CA_PEM variable');
      } catch (err) {
        console.error(`❌ Failed to load SSL certificate: ${err.message}`);
        throw err;
      }
    }
    
    console.log('🔌 Connecting to database...');
    db = knex({
      client: 'mysql2',
      connection: {
        host: new URL(datasource.url).hostname,
        user: new URL(datasource.url).username,
        password: new URL(datasource.url).password,
        database: new URL(datasource.url).pathname.slice(1),
        port: Number(new URL(datasource.url).port) || 3306,
        ssl: sslConfig,
      },
      pool: {
        min: 1,
        max: 5,
        acquireTimeoutMillis: 120000,
        idleTimeoutMillis: 60000,
        createRetryIntervalMillis: 2000,
        createTimeoutMillis: 30000,
      },
    });

    return db.raw('SELECT 1')
      .then(() => {
        console.log('✅ Database connected');
        return db;
      })
      .catch(err => {
        console.error('❌ Connection failed:', err.message);
        throw err;
      });
  }
  return Promise.resolve(db);
}

async function withRetry(operation, maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (err.message === 'aborted' && attempt < maxRetries) {
        console.log(`⚠️ Attempt ${attempt} failed: ${err.message}. Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }
}

async function migrateTables(models) {
  console.log('🔧 Running migrations...');
  try {
    for (const model of models) {
      const tableName = `${model.name.toLowerCase()}s`;
      console.log(`🔍 Checking table: ${tableName}`);
      const hasTable = await withRetry(() => db.schema.hasTable(tableName));

      if (!hasTable) {
        console.log(`🛠️ Creating table: ${tableName}`);
        await withRetry(() => db.schema.createTable(tableName, (table) => {
          for (const [fieldName, field] of Object.entries(model.fields)) {
            if (field.isId) {
              table.increments(fieldName).primary();
            } else if (field.type === 'String') {
              const col = field.isText ? table.text(fieldName) : table.string(fieldName, 255);
              if (field.isUnique) col.unique();
              if (!field.isOptional) col.notNullable();
              if (field.default !== undefined && !field.isText) {
                console.log(`🔧 Setting default "${field.default}" for ${fieldName} in ${tableName}`);
                col.defaultTo(field.default);
              }
            } else if (field.type === 'Int') {
              const col = table.integer(fieldName).unsigned();
              if (field.isUnique) col.unique();
              if (!field.isOptional) col.notNullable();
              if (field.default && field.default !== 'autoincrement') col.defaultTo(field.default);
              if (field.references) {
                const [refTable, refColumn] = field.references.split('.');
                const fkName = `${tableName}_${fieldName}_fkey`;
                console.log(`🔗 Adding FK ${fkName} for ${fieldName} in ${tableName} during creation`);
                table.foreign(fieldName, fkName)
                  .references(refColumn)
                  .inTable(`${refTable.toLowerCase()}s`)
                  .onDelete(field.onDelete ? field.onDelete.toUpperCase() : 'NO ACTION');
              }
            } else if (field.type === 'DateTime') {
              const col = table.dateTime(fieldName);
              if (!field.isOptional) col.notNullable();
              if (field.default === 'now') {
                console.log(`🔧 Setting default CURRENT_TIMESTAMP for ${fieldName} in ${tableName}`);
                col.defaultTo(db.fn.now());
              }
              if (field.isUpdatedAt) {
                console.log(`🔧 Setting default CURRENT_TIMESTAMP ON UPDATE for ${fieldName} in ${tableName}`);
                col.defaultTo(db.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
              }
            }
          }
        }));
        console.log(`✅ Created table "${tableName}"`);
      } else {
        console.log(`🔧 Updating table: ${tableName}`);
        for (const [fieldName, field] of Object.entries(model.fields)) {
          const hasColumn = await withRetry(() => db.schema.hasColumn(tableName, fieldName));
          if (!hasColumn) {
            console.log(`➕ Adding column ${fieldName} to ${tableName}`);
            await withRetry(() => db.schema.table(tableName, (table) => {
              if (field.type === 'String') {
                
                const col = field.isText ? table.text(fieldName) : table.string(fieldName, 255);
                if (field.isUnique) col.unique();
                if (!field.isOptional) col.notNullable();
                if (field.default !== undefined && !field.isText) {
                  console.log(`🔧 Setting default "${field.default}" for ${fieldName} in ${tableName}`);
                  col.defaultTo(field.default);
                }
              } else if (field.type === 'Int') {
                const col = table.integer(fieldName).unsigned();
                if (field.isUnique) col.unique();
                if (!field.isOptional) col.notNullable();
                if (field.default && field.default !== 'autoincrement') col.defaultTo(field.default);
              } else if (field.type === 'DateTime') {
                const col = table.dateTime(fieldName);
                if (!field.isOptional) {
                  col.notNullable();
                  if (field.default === 'now') {
                    console.log(`🔧 Setting default CURRENT_TIMESTAMP for ${fieldName} in ${tableName}`);
                    col.defaultTo(db.fn.now());
                  }
                  if (field.isUpdatedAt) {
                    console.log(`🔧 Setting default CURRENT_TIMESTAMP ON UPDATE for ${fieldName} in ${tableName}`);
                    col.defaultTo(db.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
                  }
                } else {
                  col.nullable();
                }
              }
            }));
          }

          // Perbaiki default yang salah di tabel lama
          if (field.type === 'String' && field.default !== undefined) {
            const columnInfo = await db.raw(`SHOW COLUMNS FROM ${tableName} WHERE Field = ?`, [fieldName]);
            if (columnInfo[0]) {
              const currentDefault = columnInfo[0].Default;
              if (currentDefault !== field.default) {
                console.log(`🔧 Updating default to "${field.default}" for ${fieldName} in ${tableName} (was ${currentDefault})`);
                await withRetry(() => db.schema.table(tableName, (table) => {
                  const col = table.string(fieldName, 255).notNullable().defaultTo(field.default);
                  if (field.isUnique) col.unique();
                  col.alter();
                }));
              }
            }
          }
          
          if (field.type === 'String' && field.isText) {
            const columnInfo = await db.raw(`SHOW COLUMNS FROM ${tableName} WHERE Field = ?`, [fieldName]);
            if (columnInfo[0]) {
              console.log(`🔧 Updating column ${fieldName} to TEXT in ${tableName}`);
              await withRetry(() => db.schema.table(tableName, (table) => {
                const col = table.text(fieldName).notNullable();
                if (field.isUnique) col.unique();
                col.alter();
              }));
            }
          }

          if (field.type === 'DateTime' && (field.default === 'now' || field.isUpdatedAt)) {
            const columnInfo = await db.raw(`SHOW COLUMNS FROM ${tableName} WHERE Field = ?`, [fieldName]);
            if (columnInfo[0]) {
              const currentDefault = columnInfo[0].Default;
              const currentExtra = columnInfo[0].Extra || '';
              const needsDefaultNow = field.default === 'now' && currentDefault !== 'CURRENT_TIMESTAMP';
              const needsUpdatedAt = field.isUpdatedAt && !currentExtra.toUpperCase().includes('ON UPDATE CURRENT_TIMESTAMP');

              if (needsDefaultNow) {
                console.log(`🔧 Updating default to CURRENT_TIMESTAMP for ${fieldName} in ${tableName}`);
                await withRetry(() => db.schema.table(tableName, (table) => {
                  table.dateTime(fieldName).notNullable().defaultTo(db.fn.now()).alter();
                }));
              }
              if (needsUpdatedAt) {
                console.log(`🔧 Updating to CURRENT_TIMESTAMP ON UPDATE for ${fieldName} in ${tableName}`);
                await withRetry(() => db.schema.table(tableName, (table) => {
                  table.dateTime(fieldName).notNullable().defaultTo(db.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')).alter();
                }));
              }
            }
          }

          if (field.references) {
            const [refTable, refColumn] = field.references.split('.');
            const fkName = `${tableName}_${fieldName}_fkey`;
            console.log(`🔗 Ensuring FK ${fkName} for ${fieldName} in ${tableName}`);

            const columnInfo = await db.raw(`SHOW COLUMNS FROM ${tableName} WHERE Field = ?`, [fieldName]);
            if (columnInfo[0] && columnInfo[0].Type !== 'int unsigned') {
              console.log(`🔧 Changing ${fieldName} to INT UNSIGNED in ${tableName}`);
              await withRetry(() => db.schema.table(tableName, (table) => {
                table.integer(fieldName).unsigned().notNullable().alter();
              }));
            }

            await withRetry(async () => {
              const fkExists = await db.raw(`
                SELECT CONSTRAINT_NAME
                FROM information_schema.TABLE_CONSTRAINTS
                WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?
              `, [tableName, fkName]);

              if (fkExists.length === 0) {
                console.log(`🔗 Adding FK ${fkName} for ${fieldName} in ${tableName}`);
                await db.schema.table(tableName, (table) => {
                  table.foreign(fieldName, fkName)
                    .references(refColumn)
                    .inTable(`${refTable.toLowerCase()}s`)
                    .onDelete(field.onDelete ? field.onDelete.toUpperCase() : 'NO ACTION');
                });
              } else {
                console.log(`ℹ️ FK ${fkName} already exists for ${fieldName} in ${tableName}`);
              }
            });
          }
        }
        console.log(`✅ Table "${tableName}" checked and updated`);
      }
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

function getDB() {
  if (!db) throw new Error('Database not initialized.');
  return db;
}

module.exports = { initDatabase, getDB, migrateTables };