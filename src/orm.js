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

findMany({ 
  where = {}, 
  select = "*", 
  include, 
  orderBy, 
  skip, 
  take, 
  cursor, 
  distinct 
} = {}) {
  let query = getDB()(this.tableName).select(select);

  // WHERE (Filter kondisi)
  query = this.applyWhere(query, where);

  // INCLUDE (JOIN dengan tabel lain)
  if (include) {
    Object.entries(include).forEach(([key, value]) => {
      query = query.leftJoin(key, `${this.tableName}.${value}`, `${key}.id`);
    });
  }

  // ORDER BY
  if (orderBy) query = query.orderBy(orderBy);

  // DISTINCT
  if (distinct) query = query.distinct(distinct);

  // PAGINATION: CURSOR atau SKIP & TAKE
  if (cursor) {
    query = query.where(cursor.field, ">", cursor.value);
  } else {
    if (skip) query = query.offset(skip);
    if (take) query = query.limit(take);
  }

  return query;
}

// Helper function buat applyWhere biar bisa dipanggil recursive
applyWhere(query, where) {
  const operatorMap = { gt: ">", gte: ">=", lt: "<", lte: "<=", equals: "=", not: "!=" };

  Object.entries(where).forEach(([key, value]) => {
    if (key === "OR") {
      query = query.where((builder) => {
        value.forEach((condition) => {
          builder.orWhere((subQuery) => this.applyWhere(subQuery, condition));
        });
      });
    } else if (key === "AND") {
      value.forEach((condition) => {
        query = query.where((builder) => this.applyWhere(builder, condition));
      });
    } else if (key === "NOT") {
      Object.entries(value).forEach(([notKey, notValue]) => {
        if (Array.isArray(notValue)) {
          query = query.whereNotIn(notKey, notValue);
        } else if (typeof notValue === "object") {
          Object.entries(notValue).forEach(([op, val]) => {
            query = query.whereNot(notKey, operatorMap[op] || "=", val);
          });
        } else {
          query = query.whereNot(notKey, notValue);
        }
      });
    } else if (typeof value === "object") {
      Object.entries(value).forEach(([op, val]) => {
        query = query.where(key, operatorMap[op] || "=", val);
      });
    } else if (Array.isArray(value)) {
      query = query.whereIn(key, value);
    } else {
      query = query.where(key, value);
    }
  });

  return query;
}

async  paginate({ where = {}, orderBy = "id", take = 3, cursor }) {
  let query = getDB()("users").select("*");

  query = this.applyWhere(query, where)

  if (cursor !== undefined && cursor !== null) {
    query = query.where(orderBy, ">=", cursor); // Pakai >= supaya ID terakhir tetap ada
  }

  query = query.orderBy(orderBy, "asc").limit(take + 1);

  const results = await query;
  const hasNextPage = results.length > take;

  // Ambil hanya `take` item pertama (buang yg lebih)
  const items = hasNextPage ? results.slice(0, take) : results;

  // `nextCursor` = ID pertama halaman selanjutnya
  const nextCursor = hasNextPage ? results[take][orderBy] : null;

  // `prevCursor` = ID pertama di halaman sebelumnya (harusnya dari query sebelumnya)
  const prevCursor = cursor || null;

  return {
    items,
    nextCursor,
    prevCursor,
    hasNextPage,
    hasPrevPage: cursor !== null,
    pageSize: take
  };
}

async find({ 
  where = {}, 
  select = "*", 
  include
} = {}) {
  try {
    if(Object.keys(where).length == 0) throw new Error("Paramater 'where' tidak boleh kosong!")
    let query = getDB()(this.tableName).select(select).first();
  
    // WHERE
    if (Object.keys(where).length > 0) {
      query = this.applyWhere(query, where)
    }
  
    // INCLUDE (JOIN dengan tabel lain)
    if (include) {
      Object.entries(include).forEach(([key, value]) => {
        query = query.leftJoin(key, `${this.tableName}.${value}`, `${key}.id`);
      });
    }
  
    const result = await query
    return result || null;
  } catch(e) {
    throw this._handleError(e)
  }
} 

  async findById({ 
  id, 
  select = "*", 
  include
} = {}) {
  try {
    if(!id) throw new Error("Paramater 'id' tidak boleh kosong!")
    let query = getDB()(this.tableName).select(select).where("id", id).first();
  
    // INCLUDE (JOIN dengan tabel lain)
    if (include) {
      Object.entries(include).forEach(([key, value]) => {
        query = query.leftJoin(key, `${this.tableName}.${value}`, `${key}.id`);
      });
    }
  
    const result = await query
    return result || null;
  } catch(e) {
    throw this._handleError(e)
  }
} 

 async create(data) {
   try {
    return await getDB()(this.tableName).insert(data).then(ids => this.findById({id: ids[0]}));
   } catch(e) {
     throw this._handleError(e)
   }
  }
  
  async delete({where = {}, data}) {
    try {
    const item = await this.find({where: where})
    if(item) {
      console.log("Deleted data")
      return await getDB()(this.tableName).where(where).del()
    } else {
      return {
        status: true,
        deleted: 0,
        message: "No data deleted!"
      }
    }
    } catch(e) {
      throw this._handleError(e)
    }
}
  
  async updateOne({where = {}, data}) {
    try {
    const item = await this.find({where: where})
    if(item) {
      console.log("Updated data")
      return await getDB()(this.tableName).where(where).update(data).then(() => this.find({where}));
    } else {
      return {
        status: true,
        updated: 0,
        message: "No data updated!"
      }
    }
    } catch(e) {
      throw this._handleError(e)
    }
}

async updateMany({where = {}, data}) {
    try {
    const items = await this.findMany({where: where})
    if(items) {
      console.log("Updated datas")
      return await getDB()(this.tableName).where(where).update(data).then(() => this.findMany({where}));
    } else {
      return {
        status: true,
        updated: 0,
        message: "No data updated!"
      }
    }
    } catch(e) {
      throw this._handleError(e)
    }
}
  
  async upsert({where = {}, data}) {
    try {
    const item = await this.find({where: where})
    if(item) {
      console.log("Updated data")
      return await getDB()(this.tableName).where(where).update(data).then(() => this.find({where}));
    } else {
      console.log("Created data")
      return await this.create(data)
    }
    } catch(e) {
      throw this._handleError(e)
    }
}
  
  _handleError(error) {
    const err = ERROR_CODES[error.errno] || {
      status: false,
      type: 'Unknown error',
      code: 'L000',
      message: error.message
      };
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

module.exports = { initORM, ORM, getDB };