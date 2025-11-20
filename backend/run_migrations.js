const fs = require('fs');
const path = require('path');
require('dotenv').config();
const pool = require('./db');

function splitSqlStatements(sql) {
  const stmts = [];
  let buf = '';
  let inSingle = false, inDouble = false, inDollar = false;
  let inLineComment = false, inBlockComment = false;
  let dollarTag = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Handle exiting comments
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        buf += ch; // preserve newline boundaries
      }
      continue;
    }
    if (inBlockComment) {
      if (next2 === '*/') {
        inBlockComment = false;
        i++; // skip '*'
      }
      continue;
    }

    // Handle start of comments when not in quotes/dollar
    if (!inSingle && !inDouble && !inDollar) {
      if (next2 === '--') {
        inLineComment = true;
        i++; // skip second '-'
        continue;
      }
      if (next2 === '/*') {
        inBlockComment = true;
        i++; // skip '*'
        continue;
      }
    }

    // Handle start/end of dollar-quoted block: $$ or $tag$ ... $tag$
    if (!inSingle && !inDouble) {
      if (!inDollar) {
        // detect $word$
        const m = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
        if (m) {
          inDollar = true;
          dollarTag = m[0];
          buf += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      } else {
        // currently in dollar; check for closing tag
        if (sql.slice(i, i + dollarTag.length) === dollarTag) {
          inDollar = false;
          buf += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      }
    }

    if (!inDollar) {
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      if (ch === '"' && !inSingle) inDouble = !inDouble;
    }

    if (ch === ';' && !inSingle && !inDouble && !inDollar) {
      const s = buf.trim();
      if (s) stmts.push(s);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

async function run() {
  // Use consolidated schema file (000_schema.sql) instead of old migrations.sql
  const schemaFile = path.join(__dirname, 'migrations', '000_schema.sql');
  const legacyFile = path.join(__dirname, 'migrations.sql');
  
  let bootstrapFile;
  if (fs.existsSync(schemaFile)) {
    bootstrapFile = schemaFile;
  } else if (fs.existsSync(legacyFile)) {
    bootstrapFile = legacyFile;
    console.warn('[migrate] Using legacy migrations.sql - consider upgrading to 000_schema.sql');
  } else {
    console.error('Schema file not found. Expected:', schemaFile, 'or', legacyFile);
    process.exit(1);
  }

  const sql = fs.readFileSync(bootstrapFile, 'utf8');
  try {
    console.log('Running migrations...');
    // execute the whole file contents; pg supports multi-statement queries
    await pool.query(sql);
    const fileName = path.basename(bootstrapFile);
    console.log(`Base ${fileName} applied successfully`);
  } catch (err) {
    console.error('Error applying migrations (batch mode):', err.message || err);
    // Fallback: run sequentially and ignore specific undefined-table errors to recover mixed-state installs
    try {
      console.warn('[migrate] Falling back to sequential mode...');
      const parts = splitSqlStatements(sql);
      for (let i = 0; i < parts.length; i++) {
        const stmt = parts[i];
        try {
          await pool.query(stmt);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          const code = e && e.code ? e.code : null;
          // tolerate undefined table/column to allow idempotent re-runs on partially initialized DBs
          if (code === '42P01' || /relation\s+"?users"?\s+does not exist/i.test(msg)) {
            console.warn(`[migrate] ignoring undefined_table at stmt ${i + 1}:`, msg.split('\n')[0]);
            continue;
          }
          // tolerate duplicate objects (functions, constraints, etc.) for idempotent re-runs
          if (code === '42710' || code === '42P07' || /already exists/i.test(msg)) {
            console.warn(`[migrate] ignoring duplicate at stmt ${i + 1}:`, msg.split('\n')[0]);
            continue;
          }
          // surface other errors
          console.error(`[migrate] statement ${i + 1} failed:`, msg);
          throw e;
        }
      }
      const fileName = path.basename(bootstrapFile);
      console.log(`Base ${fileName} applied successfully (sequential fallback)`);
    } catch (e2) {
      console.error('Error applying migrations (sequential mode):', e2 && e2.message ? e2.message : e2);
      process.exitCode = 2;
    }
  }

  // After base file, also apply any additional .sql files in ./migrations (sorted)
  // Skip 000_schema.sql (already applied) and per-table schemas (001-017-table-*.sql are redundant with 000_schema.sql)
  try {
    const dir = path.join(__dirname, 'migrations');
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.sql'))
        .filter(f => !f.startsWith('000_schema.sql')) // Skip base schema (already applied)
        .filter(f => !/^\d{3}-table-.*\.sql$/.test(f)) // Skip per-table schemas (redundant with 000_schema.sql)
        .sort((a, b) => a.localeCompare(b));
      for (const f of files) {
        const full = path.join(dir, f);
        const content = fs.readFileSync(full, 'utf8');
        const parts = splitSqlStatements(content);
        console.log(`[migrate] applying ${f} (${parts.length} statements)`);
        for (let i = 0; i < parts.length; i++) {
          const stmt = parts[i];
          try {
            await pool.query(stmt);
          } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            const code = e && e.code ? e.code : null;
            // tolerate undefined table/column to allow idempotent re-runs on partially initialized DBs
            if (code === '42P01' || /does not exist/i.test(msg)) {
              console.warn(`[migrate] (${f}) ignoring error at stmt ${i + 1}:`, msg.split('\n')[0]);
              continue;
            }
            // tolerate duplicate objects (functions, constraints, tables, etc.) for idempotent re-runs
            if (code === '42710' || code === '42P07' || /already exists/i.test(msg)) {
              console.warn(`[migrate] (${f}) ignoring duplicate at stmt ${i + 1}:`, msg.split('\n')[0]);
              continue;
            }
            console.error(`[migrate] (${f}) statement ${i + 1} failed:`, msg);
            throw e;
          }
        }
        console.log(`[migrate] applied ${f}`);
      }
    }
  } catch (err) {
    console.error('[migrate] error applying per-file migrations:', err && err.message ? err.message : err);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) run();
module.exports = run;
