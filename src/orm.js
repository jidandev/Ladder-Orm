const { getDB, initDatabase, migrateTables } = require('./db');
const { parseSchema } = require('./parser');
const ERROR_CODES = {
  '1062': { code: 'L100', type: 'database_error', message: 'Unique constraint failed (Duplicate entry)' },
  '1452': { code: 'L101', type: 'database_error', message: 'Foreign key constraint failed' },
  '1048': { code: 'L102', type: 'validation_error', message: 'NOT NULL constraint failed' },
  '4025': { code: 'L103', type: 'validation_error', message: 'Check constraint failed' },
  '1068': { code: 'L104', type: 'database_error', message: 'Primary key conflict' },
  '1264': { code: 'L200', type: 'validation_error', message: 'Value out of range' },
  '1366': { code: 'L201', type: 'validation_error', message: 'Invalid encoding' },
  '1292': { code: 'L202', type: 'validation_error', message: 'Invalid date format' },
  '1146': { code: 'L300', type: 'database_error', message: 'Table not found' },
  '1054': { code: 'L301', type: 'database_error', message: 'Column not found' },
  '1064': { code: 'L303', type: 'syntax_error', message: 'Invalid SQL syntax' },
  '1205': { code: 'L500', type: 'transaction_error', message: 'Transaction deadlock detected' },
  '1213': { code: 'L501', type: 'transaction_error', message: 'Transaction rollback' },
  '1040': { code: 'L400', type: 'connection_error', message: 'Too many connections' },
  '2003': { code: 'L401', type: 'connection_error', message: 'Database connection failed' },
  '28000': { code: 'L402', type: 'authentication_error', message: 'Invalid database credentials' },
  '42000': { code: 'L403', type: 'authorization_error', message: 'Access denied' },
  '1141': { code: 'L901', type: 'authorization_error', message: 'Unauthorized access' },
  '1105': { code: 'L700', type: 'orm_error', message: 'Unexpected ORM error' },
};


class ORM {
  constructor(schemaPath) {
    this.schema = parseSchema(schemaPath);
    initDatabase(this.schema.datasource);
    this.models = {};
    this.initModels();
  }

  async init() {
    await migrateTables(this.schema.models);
  }

  initModels() {
    for (const model of this.schema.models) {
      this.models[model.name.toLowerCase()] = new Model(model);
    }
  }

  model(name) {
    return this.models[name.toLowerCase()];
  }
}

class Model {
  constructor(model) {
    this.tableName = `${model.name.toLowerCase()}s`;
  }

  findAll() {
  let query = getDB()(this.tableName).select('*');

  return new Proxy(query, {
    get(target, prop) {
      if (prop === 'amount') {
        return (n) => new Proxy(target.clone().limit(n), this);
      }
      if (prop === 'orderBy') {
        return (column, direction = 'asc') => new Proxy(target.clone().orderBy(column, direction), this);
      }
      if (prop === 'whereNot') {
        return (column, value) => new Proxy(target.clone().whereNot(column, value), this);
      }
      return target[prop]; // Kembalikan method asli Knex jika bukan custom method
    }
  });
}

except(excObj) {
  let query = getDB()(this.tableName).select('*');

  // Loop semua field di excObj dan terapkan whereNot
  Object.entries(excObj).forEach(([key, value]) => {
    query = query.whereNot(key, value);
  });

  return new Proxy(query, {
    get(target, prop) {
      if (prop === 'amount') {
        return (n) => new Proxy(target.clone().limit(n), this);
      }
      if (prop === 'orderBy') {
        return (column, direction = 'asc') => new Proxy(target.clone().orderBy(column, direction), this);
      }
      return Reflect.get(target, prop);
    }
  });
}

find(findObj) {
  let query = getDB()(this.tableName).select('*');


  Object.entries(findObj).forEach(([key, value]) => {
    query = query.where(key, value);
  });

  return new Proxy(query, {
    get(target, prop) {
      if (prop === 'amount') {
        return (n) => new Proxy(target.clone().limit(n), this);
      }
      if (prop === 'orderBy') {
        return (column, direction = 'asc') => new Proxy(target.clone().orderBy(column, direction), this);
      }
      return Reflect.get(target, prop);
    }
  });
}

  async findById(id) {
    try {
    const data = await getDB()(this.tableName).where('id', id).first();
    if (!data) return null
    return data
    } catch(e) {
      throw this._handleError(e)
    }
  }

 async create(data) {
   try {
    return await getDB()(this.tableName).insert(data).then(ids => this.findById(ids[0]));
   } catch(e) {
     throw this._handleError(e)
   }
  }
  
  _handleError(error) {
    const err = ERROR_CODES[error.errno] || { code: 'L000', message: 'Unknown database error' };
  return {
    status: false,
    type: err.type,
    code: err.code,
    message: err.message
  };
  }
}

Model.prototype.insert = Model.prototype.create;


function initORM(schemaPath) {
  const orm = new ORM(schemaPath);
  return orm.init().then(() => orm);
}

module.exports = { initORM, ORM };