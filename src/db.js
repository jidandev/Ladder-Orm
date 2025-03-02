const knex = require('knex');
const fs = require('fs');

let db;

function initDatabase(datasource) {
  if (!db) {
    console.log('🔌 Connecting to database...');
    db = knex({
      client: 'mysql2',
      connection: {
        host: new URL(datasource.url).hostname,
        user: new URL(datasource.url).username,
        password: new URL(datasource.url).password,
        database: new URL(datasource.url).pathname.slice(1),
        port: Number(new URL(datasource.url).port) || 3306,
        ssl: datasource.ssl
          ? { ca: fs.readFileSync(datasource.ssl).toString(), rejectUnauthorized: false }
          : false,
      },
    });
    db.raw('SELECT 1')
      .then(() => console.log('✅ Database connected'))
      .catch(err => console.error('❌ Connection failed:', err.message));
  }
  return db;
}

async function migrateTables(models) {
  console.log('🔧 Running migrations...');
  try {
    for (const model of models) {
      const tableName = `${model.name.toLowerCase()}s`;
      const hasTable = await db.schema.hasTable(tableName);

      if (!hasTable) {
        // Buat tabel baru jika belum ada
        await db.schema.createTable(tableName, (table) => {
          for (const [fieldName, field] of Object.entries(model.fields)) {
            if (field.isId) {
              table.increments(fieldName).primary();
            } else if (field.type === 'String') {
              const col = table.string(fieldName, 255);
              if (field.isUnique) col.unique();
              if (!field.isOptional) col.notNullable();
              if (field.default) col.defaultTo(field.default);
            } else if (field.type === 'Int') {
              const col = table.integer(fieldName);
              if (field.isUnique) col.unique();
              if (!field.isOptional) col.notNullable();
              if (field.default) col.defaultTo(field.default);
            }
          }
        });
        console.log(`✅ Created table "${tableName}"`);
      } else {
        // Cek dan sesuaikan tabel yang sudah ada
        for (const [fieldName, field] of Object.entries(model.fields)) {
          const hasColumn = await db.schema.hasColumn(tableName, fieldName);
          if (!hasColumn) {
            await db.schema.table(tableName, (table) => {
              if (field.type === 'String') {
                const col = table.string(fieldName, 255);
                if (field.isUnique) col.unique();
                if (!field.isOptional) col.notNullable();
                if (field.default) col.defaultTo(field.default);
              } else if (field.type === 'Int') {
                const col = table.integer(fieldName);
                if (field.isUnique) col.unique();
                if (!field.isOptional) col.notNullable();
                if (field.default) col.defaultTo(field.default);
              }
            });
            console.log(`✅ Added column "${fieldName}" to "${tableName}"`);
          }
          // Cek unique constraint (simpel: skip jika error)
          if (field.isUnique && fieldName !== 'id') {
            try {
              await db.schema.table(tableName, (table) => {
                table.unique(fieldName, `${tableName}_${fieldName}_unique`);
              });
            } catch (err) {
              if (err.code === 'ER_DUP_KEYNAME') {
                console.log(`ℹ️ Unique constraint on "${fieldName}" already exists in "${tableName}"`);
              } else {
                throw err;
              }
            }
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