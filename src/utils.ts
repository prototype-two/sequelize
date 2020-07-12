const DataTypes = require('./data-types');
const SqlString = require('./sql-string');
const _ = require('lodash');
const baseIsNative = require('lodash/_baseIsNative');
const uuidv1 = require('uuid').v1;
const uuidv4 = require('uuid').v4;
const operators = require('./operators');
const operatorsSet = new Set(Object.values(operators));

let inflection = require('inflection');

export { classToInvokable } from './utils/class-to-invokable';
export { joinSQLFragments } from './utils/join-sql-fragments';

export let useInflection;
function useInflection(_inflection) {
  inflection = _inflection;
}

export function underscoredIf(str: string, condition: boolean): string {
  if (condition) {
    return underscore(str);
  }

  return str;
}

export function isPrimitive(val: unknown): val is string | number | boolean {
  const type = typeof val;
  return type === 'string' || type === 'number' || type === 'boolean';
}

// Same concept as _.merge, but don't overwrite properties that have already been assigned
function mergeDefaults(a, b) {
  return _.mergeWith(a, b, (objectValue, sourceValue) => {
    // If it's an object, let _ handle it this time, we will be called again for each property
    if (!_.isPlainObject(objectValue) && objectValue !== undefined) {
      // _.isNative includes a check for core-js and throws an error if present.
      // Depending on _baseIsNative bypasses the core-js check.
      if (_.isFunction(objectValue) && baseIsNative(objectValue)) {
        return sourceValue || objectValue;
      }
      return objectValue;
    }
  });
}
exports.mergeDefaults = mergeDefaults;

// An alternative to _.merge, which doesn't clone its arguments
// Cloning is a bad idea because options arguments may contain references to sequelize
// models - which again reference database libs which don't like to be cloned (in particular pg-native)
function merge(...args: object[]): object {
  const result = {};

  for (const obj of args) {
    _.forOwn(obj, (value, key) => {
      if (value !== undefined) {
        if (!result[key]) {
          result[key] = value;
        } else if (_.isPlainObject(value) && _.isPlainObject(result[key])) {
          result[key] = merge(result[key], value);
        } else if (Array.isArray(value) && Array.isArray(result[key])) {
          result[key] = value.concat(result[key]);
        } else {
          result[key] = value;
        }
      }
    });
  }

  return result;
}
exports.merge = merge;

/**
 * Takes the substring from 0 to `index` of `str` then concats `add` and `str[index+count:]`
 */
export function spliceStr(str: string, index: number, count: number, add: string): string {
  return str.slice(0, index) + add + str.slice(index + count);
}

export function camelize(str: string): string {
  return str.trim().replace(/[-_\s]+(.)?/g, (match, c) => c.toUpperCase());
}

export function underscore(str: string): string {
  return inflection.underscore(str);
}

export function singularize(str: string): string {
  return inflection.singularize(str);
}

export function pluralize(str: string): string {
  return inflection.pluralize(str);
}

export function format(arr: string[], dialect: string) {
  const timeZone = null;
  // Make a clone of the array beacuse format modifies the passed args
  return SqlString.format(arr[0], arr.slice(1), timeZone, dialect);
}

export function formatNamedParameters(sql: string, parameters: { [key: string]: string }, dialect: string): string {
  const timeZone = null;
  return SqlString.formatNamedParameters(sql, parameters, timeZone, dialect);
}

function cloneDeep<T extends object>(obj: T, onlyPlain?: boolean): T {
  obj = obj || {};
  return _.cloneDeepWith(obj, elem => {
    // Do not try to customize cloning of arrays or POJOs
    if (Array.isArray(elem) || _.isPlainObject(elem)) {
      return undefined;
    }

    // If we specified to clone only plain objects & arrays, we ignore everyhing else
    // In any case, don't clone stuff that's an object, but not a plain one - fx example sequelize models and instances
    if (onlyPlain || typeof elem === 'object') {
      return elem;
    }

    // Preserve special data-types like `fn` across clones. _.get() is used for checking up the prototype chain
    if (elem && typeof elem.clone === 'function') {
      return elem.clone();
    }
  });
}
exports.cloneDeep = cloneDeep;

/* Expand and normalize finder options */
function mapFinderOptions(options, Model) {
  if (options.attributes && Array.isArray(options.attributes)) {
    options.attributes = Model._injectDependentVirtualAttributes(options.attributes);
    options.attributes = options.attributes.filter(v => !Model._virtualAttributes.has(v));
  }

  mapOptionFieldNames(options, Model);

  return options;
}
exports.mapFinderOptions = mapFinderOptions;

/* Used to map field names in attributes and where conditions */
function mapOptionFieldNames(options, Model) {
  if (Array.isArray(options.attributes)) {
    options.attributes = options.attributes.map(attr => {
      // Object lookups will force any variable to strings, we don't want that for special objects etc
      if (typeof attr !== 'string') return attr;
      // Map attributes to aliased syntax attributes
      if (Model.rawAttributes[attr] && attr !== Model.rawAttributes[attr].field) {
        return [Model.rawAttributes[attr].field, attr];
      }
      return attr;
    });
  }

  if (options.where && _.isPlainObject(options.where)) {
    options.where = mapWhereFieldNames(options.where, Model);
  }

  return options;
}
exports.mapOptionFieldNames = mapOptionFieldNames;

function mapWhereFieldNames(attributes, Model) {
  if (attributes) {
    getComplexKeys(attributes).forEach(attribute => {
      const rawAttribute = Model.rawAttributes[attribute];

      if (rawAttribute && rawAttribute.field !== rawAttribute.fieldName) {
        attributes[rawAttribute.field] = attributes[attribute];
        delete attributes[attribute];
      }

      if (
        _.isPlainObject(attributes[attribute]) &&
        !(
          rawAttribute &&
          (rawAttribute.type instanceof DataTypes.HSTORE || rawAttribute.type instanceof DataTypes.JSON)
        )
      ) {
        // Prevent renaming of HSTORE & JSON fields
        attributes[attribute] = mapOptionFieldNames(
          {
            where: attributes[attribute]
          },
          Model
        ).where;
      }

      if (Array.isArray(attributes[attribute])) {
        attributes[attribute].forEach((where, index) => {
          if (_.isPlainObject(where)) {
            attributes[attribute][index] = mapWhereFieldNames(where, Model);
          }
        });
      }
    });
  }

  return attributes;
}
exports.mapWhereFieldNames = mapWhereFieldNames;

/* Used to map field names in values */
export function mapValueFieldNames(dataValues, fields, Model): object {
  const values = {};

  for (const attr of fields) {
    if (dataValues[attr] !== undefined && !Model._virtualAttributes.has(attr)) {
      // Field name mapping
      if (Model.rawAttributes[attr] && Model.rawAttributes[attr].field && Model.rawAttributes[attr].field !== attr) {
        values[Model.rawAttributes[attr].field] = dataValues[attr];
      } else {
        values[attr] = dataValues[attr];
      }
    }
  }

  return values;
}

export function isColString(value: string): boolean {
  return typeof value === 'string' && value[0] === '$' && value[value.length - 1] === '$';
}

export function canTreatArrayAsAnd(arr: unknown[]): boolean {
  return arr.some(arg => _.isPlainObject(arg) || arg instanceof Where);
}

/**
 * Creates a deterministic combined table name.
 */
export function combineTableNames(tableName1: string, tableName2: string): string {
  return tableName1.toLowerCase() < tableName2.toLowerCase() ? tableName1 + tableName2 : tableName2 + tableName1;
}

export function toDefaultValue(value: unknown, dialect: string): unknown {
  if (typeof value === 'function') {
    const tmp = value();
    if (tmp instanceof DataTypes.ABSTRACT) {
      return tmp.toSql();
    }
    return tmp;
  }
  if (value instanceof DataTypes.UUIDV1) {
    return uuidv1();
  }
  if (value instanceof DataTypes.UUIDV4) {
    return uuidv4();
  }
  if (value instanceof DataTypes.NOW) {
    return now(dialect);
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (_.isPlainObject(value)) {
    return { ...value };
  }
  return value;
}

/**
 * Determine if the default value provided exists and can be described
 * in a db schema using the DEFAULT directive.
 *
 * @private
 */
export function defaultValueSchemable(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  // TODO this will be schemable when all supported db
  // have been normalized for this case
  if (value instanceof DataTypes.NOW) {
    return false;
  }

  if (value instanceof DataTypes.UUIDV1 || value instanceof DataTypes.UUIDV4) {
    return false;
  }

  return typeof value !== 'function';
}

function removeNullValuesFromHash(hash, omitNull, options?: { allowNull?: string[] }) {
  let result = hash;

  options = {
    allowNull: [],
    ...options
  };

  if (omitNull) {
    const _hash: {
      [key: string]: unknown;
    } = {};

    _.forIn(hash, (val, key) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (options!.allowNull!.includes(key) || key.endsWith('Id') || (val !== null && val !== undefined)) {
        _hash[key] = val;
      }
    });

    result = _hash;
  }

  return result;
}
exports.removeNullValuesFromHash = removeNullValuesFromHash;

const dialects = new Set(['mariadb', 'mysql', 'postgres', 'sqlite', 'mssql']);

export function now(dialect: string): Date {
  const d = new Date();
  if (!dialects.has(dialect)) {
    d.setMilliseconds(0);
  }
  return d;
}

// Note: Use the `quoteIdentifier()` and `escape()` methods on the
// `QueryInterface` instead for more portable code.

export const TICK_CHAR = '`';

export function addTicks(s: string, tickChar: string = TICK_CHAR): string {
  return tickChar + removeTicks(s, tickChar) + tickChar;
}

export function removeTicks(s: string, tickChar: string = TICK_CHAR): string {
  return s.replace(new RegExp(tickChar, 'g'), '');
}

/**
 * Receives a tree-like object and returns a plain object which depth is 1.
 *
 * - Input:
 *
 *  {
 *    name: 'John',
 *    address: {
 *      street: 'Fake St. 123',
 *      coordinates: {
 *        longitude: 55.6779627,
 *        latitude: 12.5964313
 *      }
 *    }
 *  }
 *
 * - Output:
 *
 *  {
 *    name: 'John',
 *    address.street: 'Fake St. 123',
 *    address.coordinates.latitude: 55.6779627,
 *    address.coordinates.longitude: 12.5964313
 *  }
 *
 * @param {object} value an Object
 * @returns {object} a flattened object
 * @private
 */
export function flattenObjectDeep(value: unknown): { [key: string]: string | number | boolean | symbol | bigint | Function } {
  if (!_.isPlainObject(value)) return value;
  const flattenedObj = {};

  function flattenObject(obj, subPath: string) {
    Object.keys(obj).forEach(key => {
      const pathToProperty = subPath ? `${subPath}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        flattenObject(obj[key], pathToProperty);
      } else {
        flattenedObj[pathToProperty] = _.get(obj, key);
      }
    });
    return flattenedObj;
  }

  return flattenObject(value, undefined);
}

/**
 * Utility functions for representing SQL functions, and columns that should be escaped.
 * Please do not use these functions directly, use Sequelize.fn and Sequelize.col instead.
 *
 * @private
 */
abstract class SequelizeMethod {}
exports.SequelizeMethod = SequelizeMethod;

class Fn extends SequelizeMethod {
  constructor(fn, args) {
    super();
    this.fn = fn;
    this.args = args;
  }
  clone() {
    return new Fn(this.fn, this.args);
  }
}
exports.Fn = Fn;

class Col extends SequelizeMethod {
  constructor(col, ...args) {
    super();
    if (args.length > 0) {
      col = args;
    }
    this.col = col;
  }
}
exports.Col = Col;

export class Cast extends SequelizeMethod {
  private type: string;
  constructor(private val: unknown, type: string, private json = false) {
    super();
    this.type = (type || '').trim();
  }
}

export class Literal extends SequelizeMethod {
  constructor(private val: string) {
    super();
  }
}

export class Json extends SequelizeMethod {
  constructor(conditionsOrPath: string | object, value: unknown) {
    super();
    if (_.isObject(conditionsOrPath)) {
      this.conditions = conditionsOrPath;
    } else {
      this.path = conditionsOrPath;
      if (value) {
        this.value = value;
      }
    }
  }
}

export class Where extends SequelizeMethod {
  public readonly comparator: string;
  public readonly logic: string;

  constructor(public readonly attribute: string, comparator: string, logic: string) {
    super();
    if (logic === undefined) {
      logic = comparator;
      comparator = '=';
    }

    this.comparator = comparator;
    this.logic = logic;
  }
}

//Collection of helper methods to make it easier to work with symbol operators

/**
 * @private
 */
function getOperators(obj: object): symbol[] {
  return Object.getOwnPropertySymbols(obj).filter(s => operatorsSet.has(s));
}
exports.getOperators = getOperators;

/**
 * @private
 */
export function getComplexKeys(obj: object): Array<symbol | string> {
  return getOperators(obj).concat(Object.keys(obj));
}

/**
 * getComplexSize
 *
 * @param  {object|Array} obj
 * @returns {number}      Length of object properties including operators if obj is array returns its length
 * @private
 */
export function getComplexSize(obj: object | unknown[]): number {
  return Array.isArray(obj) ? obj.length : getComplexKeys(obj).length;
}

/**
 * Returns true if a where clause is empty, even with Symbols
 *
 * @param  {object} obj
 * @returns {boolean}
 * @private
 */
export function isWhereEmpty(obj: object) {
  return !!obj && _.isEmpty(obj) && getOperators(obj).length === 0;
}

/**
 * Returns ENUM name by joining table and column name
 * @private
 */
export function generateEnumName(tableName: string, columnName: string): string {
  return `enum_${tableName}_${columnName}`;
}

/**
 * Returns an new Object which keys are camelized
 * @private
 */
export function camelizeObjectKeys(obj: { [key: string]: string }): { [key: string]: string } {
  const newObj: { [key: string]: string } = {};
  Object.keys(obj).forEach(key => {
    newObj[camelize(key)] = obj[key];
  });
  return newObj

}

interface NameIndex {
  fields: Array<string | {
    name: string;
    attribute: string;
  }>;
  name?: string;
}

/**
 * @private
 */
export function nameIndex(index: NameIndex, tableName: string | { tableName: string }): NameIndex {
  if (typeof tableName === 'object' && tableName.tableName) tableName = tableName.tableName;

  if (!Object.prototype.hasOwnProperty.call(index, 'name')) {
    const fields = index.fields.map(field => (typeof field === 'string' ? field : field.name || field.attribute));
    index.name = underscore(`${tableName}_${fields.join('_')}`);
  }

  return index;
}

/**
 * Checks if 2 arrays intersect.
 * @private
 */
export function intersects(arr1: unknown[], arr2: unknown[]): boolean {
  return arr1.some(v => arr2.includes(v));
}
