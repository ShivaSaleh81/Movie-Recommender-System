// load-movies-node.js
// Pure Node.js loader that uses fs.readFileSync + JSON.parse (exactly as your assignment states).
// It connects to MongoDB via the official driver and bulk-inserts your movies.
// ---------------------------------------------
// Usage:
//   1) Ensure Node.js is installed (node -v)
//   2) npm init -y
//      npm i mongodb
//   3) Put movies.json next to this file
//   4) Run: node load-movies-node.js
// ---------------------------------------------
// Optional env vars:
//   MONGO_URI=mongodb://localhost:27017  DB=movieDB  COLL=movies
//
// Accepts JSON array, single object, {movies:[...]}, or NDJSON.

const fs = require('fs');
const { MongoClient } = require('mongodb');

const URI  = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB   = process.env.DB || 'movieDB';
const COLL = process.env.COLL || 'movies';

function stripBOM(s) {
  return s && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function tryParseStandardJSON(raw) {
  const parsed = JSON.parse(raw);
  if (parsed && Array.isArray(parsed.movies)) return parsed.movies;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

function tryParseNDJSON(raw) {
  const lines = raw.split(/\r?\n/);
  const arr = [];
  for (let line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#')) continue;
    try { arr.push(JSON.parse(t)); } catch (_) {}
  }
  return arr;
}

(async () => {
  let raw = fs.readFileSync('movies.json', 'utf8');
  raw = stripBOM(raw).trim();

  let docs = [];
  try {
    docs = tryParseStandardJSON(raw);
  } catch (e) {
    // If standard parse fails, try NDJSON as fallback
    docs = tryParseNDJSON(raw);
  }

  if (!docs || !docs.length) {
    throw new Error("Failed to parse 'movies.json'. Ensure it's valid JSON/NDJSON.");
  }

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);
  const col = db.collection(COLL);

  const res = await col.insertMany(docs, { ordered: false });
  console.log(`✅ Inserted ${res.insertedCount || Object.keys(res.insertedIds).length} documents into ${DB}.${COLL}`);

  await client.close();
})().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
