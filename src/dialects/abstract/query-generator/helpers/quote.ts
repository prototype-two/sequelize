/**
 * Quote helpers implement quote ability for all dialects.
 * These are basic block of query building
 *
 * Its better to implement all dialect implementation together here. Which will allow
 * even abstract generator to use them by just specifying dialect type.
 *
 * Defining these helpers in each query dialect will leave
 * code in dual dependency of abstract <-> specific dialect
 */
import { addTicks, removeTicks } from '../../../../utils';

/**
 * list of reserved words in PostgreSQL 10
 * source: https://www.postgresql.org/docs/10/static/sql-keywords-appendix.html
 */
const postgresReservedWords = 'all,analyse,analyze,and,any,array,as,asc,asymmetric,authorization,binary,both,case,cast,check,collate,collation,column,concurrently,constraint,create,cross,current_catalog,current_date,current_role,current_schema,current_time,current_timestamp,current_user,default,deferrable,desc,distinct,do,else,end,except,false,fetch,for,foreign,freeze,from,full,grant,group,having,ilike,in,initially,inner,intersect,into,is,isnull,join,lateral,leading,left,like,limit,localtime,localtimestamp,natural,not,notnull,null,offset,on,only,or,order,outer,overlaps,placing,primary,references,returning,right,select,session_user,similar,some,symmetric,table,tablesample,then,to,trailing,true,union,unique,user,using,variadic,verbose,when,where,window,with'.split(
  ','
);

export interface QuoteIdentifierOptions {
  /**
   * @default {false}
   */
  force?: boolean;
  /**
   * @default {true}
   */
  quoteIdentifiers?: boolean;
}

/**
 * @private
 */
export function quoteIdentifier(dialect: string, identifier: string, options?: QuoteIdentifierOptions): string {
  if (identifier === '*') return identifier;

  options = {
    force: false,
    quoteIdentifiers: true,
    ...options
  };

  switch (dialect) {
    case 'sqlite':
    case 'mariadb':
    case 'mysql':
      return addTicks(removeTicks(identifier, '`'), '`');

    case 'postgres':
      // eslint-disable-next-line no-case-declarations
      const rawIdentifier = removeTicks(identifier, '"');

      if (
        options.force !== true &&
        options.quoteIdentifiers === false &&
        !identifier.includes('.') &&
        !identifier.includes('->') &&
        !postgresReservedWords.includes(rawIdentifier.toLowerCase())
      ) {
        // In Postgres, if tables or attributes are created double-quoted,
        // they are also case sensitive. If they contain any uppercase
        // characters, they must always be double-quoted. This makes it
        // impossible to write queries in portable SQL if tables are created in
        // this way. Hence, we strip quotes if we don't want case sensitivity.
        return rawIdentifier;
      }
      return addTicks(rawIdentifier, '"');
    case 'mssql':
      return `[${identifier.replace(/[[\]']+/g, '')}]`;

    default:
      throw new Error(`Dialect "${dialect}" is not supported`);
  }
}

/**
 * Test if a give string is already quoted
 * @private
 */
export function isIdentifierQuoted(identifier: string): boolean {
  return /^\s*(?:([`"'])(?:(?!\1).|\1{2})*\1\.?)+\s*$/i.test(identifier);
}
