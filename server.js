// server.js — final version (PDF formula uses log10(votes)/100)

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB || 'movieDB';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let client, db, Movies, Users;

// ---------- helpers ----------
function toObjectId(id) { try { return new ObjectId(id); } catch { return null; } }
function tally(arrs) {
  const counts = Object.create(null);
  for (const a of arrs) {
    if (!Array.isArray(a)) continue;
    for (const x of a) { if (x != null) counts[x] = (counts[x] || 0) + 1; }
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
}
function dictToKV(d) { return Object.entries(d).map(([k, v]) => ({ k, v })); } // for $filter (no $getField)

// ---------- connect ----------
async function connect() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  Movies = db.collection('movies');
  Users  = db.collection('users');
  console.log(`✅ Connected to ${MONGO_URI}/${DB_NAME}`);
}

// ---------- auth + basics ----------
app.post('/api/login', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  let user = await Users.findOne({ username });
  if (!user) {
    const doc = { username, watched_movies: [] };
    const r = await Users.insertOne(doc);
    user = { _id: r.insertedId, ...doc };
  }
  res.json({ ok: true, user: { username: user.username } });
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  const list = await Movies.find(
    { title: { $regex: q, $options: 'i' } },
    { projection: { title: 1, release_year: 1, rating: 1 } }
  ).limit(20).toArray();
  res.json(list);
});

app.get('/api/watched', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });
  const user = await Users.findOne({ username });
  if (!user) return res.status(404).json({ error: 'user not found' });
  let ids = user.watched_movies || user.seen_movies || [];
  ids = ids.map(x => (x instanceof ObjectId ? x : toObjectId(String(x)))).filter(Boolean);
  const movies = ids.length
    ? await Movies.find({ _id: { $in: ids } }, { projection: { title:1, release_year:1, rating:1 } }).toArray()
    : [];
  res.json(movies);
});

app.post('/api/watched/add', async (req, res) => {
  const { username, movieId } = req.body || {};
  if (!username || !movieId) return res.status(400).json({ error: 'username and movieId required' });
  const oid = toObjectId(movieId); if (!oid) return res.status(400).json({ error: 'invalid movieId' });
  await Users.updateOne({ username }, { $addToSet: { watched_movies: oid } });
  res.json({ ok: true });
});

app.post('/api/watched/remove', async (req, res) => {
  const { username, movieId } = req.body || {};
  if (!username || !movieId) return res.status(400).json({ error: 'username and movieId required' });
  const oid = toObjectId(movieId); if (!oid) return res.status(400).json({ error: 'invalid movieId' });
  await Users.updateOne({ username }, { $pull: { watched_movies: oid } });
  res.json({ ok: true });
});

// ---------- recommend (PDF formula: rating/20 + log10(votes)/100) ----------
app.get('/api/recommend', async (req, res) => {
  try {
    const USERNAME = (req.query.username || '').trim();
    if (!USERNAME) return res.status(400).json({ error: 'username required' });

    const minYear  = req.query.minYear  ? Number(req.query.minYear)  : undefined;
    const minVotes = req.query.minVotes ? Number(req.query.minVotes) : undefined;
    const wg = Number.isFinite(Number(req.query.wg)) ? Number(req.query.wg) : 0.4;
    const wd = Number.isFinite(Number(req.query.wd)) ? Number(req.query.wd) : 0.25;
    const wa = Number.isFinite(Number(req.query.wa)) ? Number(req.query.wa) : 0.15;
    const limit = req.query.limit ? Math.max(1, Math.min(100, Number(req.query.limit))) : 20;

    const user = await Users.findOne({ username: USERNAME });
    if (!user) return res.status(404).json({ error: 'user not found' });

    let watchedIds = (user.watched_movies && user.watched_movies.length ? user.watched_movies : (user.seen_movies || [])) || [];
    watchedIds = watchedIds.map(x => (x instanceof ObjectId ? x : toObjectId(String(x)))).filter(Boolean);

    const watchedMovies = watchedIds.length
      ? await Movies.find({ _id: { $in: watchedIds } }, { projection: { genres:1, directors:1, cast:1 } }).toArray()
      : [];

    const gw = tally(watchedMovies.map(m => m.genres));
    const dw = tally(watchedMovies.map(m => m.directors));
    const aw = tally(watchedMovies.map(m => m.cast));
    const gwKV = dictToKV(gw);
    const dwKV = dictToKV(dw);
    const awKV = dictToKV(aw);

    const matchStage = { _id: { $nin: watchedIds } };
    if (minYear)  matchStage['release_year'] = Object.assign(matchStage['release_year'] || {}, { $gte: minYear });
    if (minVotes) matchStage['votes']        = Object.assign(matchStage['votes'] || {},        { $gte: minVotes });

    const pipeline = [
      { $match: matchStage },

      // scores using $filter on pre-baked {k,v} arrays
      {
        $addFields: {
          genre_score: {
            $sum: {
              $map: {
                input: { $ifNull: ['$genres', []] },
                as: 'g',
                in: {
                  $let: {
                    vars: {
                      m: { $first: { $filter: { input: gwKV, as: 'w', cond: { $eq: ['$$w.k', '$$g'] } } } }
                    },
                    in: { $ifNull: ['$$m.v', 0] }
                  }
                }
              }
            }
          },
          director_score: {
            $sum: {
              $map: {
                input: { $ifNull: ['$directors', []] },
                as: 'd',
                in: {
                  $let: {
                    vars: {
                      m: { $first: { $filter: { input: dwKV, as: 'w', cond: { $eq: ['$$w.k', '$$d'] } } } }
                    },
                    in: { $ifNull: ['$$m.v', 0] }
                  }
                }
              }
            }
          },
          actor_score: {
            $sum: {
              $map: {
                input: { $ifNull: ['$cast', []] },
                as: 'a',
                in: {
                  $let: {
                    vars: {
                      m: { $first: { $filter: { input: awKV, as: 'w', cond: { $eq: ['$$w.k', '$$a'] } } } }
                    },
                    in: { $ifNull: ['$$m.v', 0] }
                  }
                }
              }
            }
          }
        }
      },

      // votes term exactly as PDF: log10(votes)/100 (safe for votes=0/null)
      {
        $addFields: {
          votes_bonus: {
            $divide: [
              {
                $log10: {
                  $cond: [
                    { $gt: [ { $ifNull: ['$votes', 0] }, 0 ] },
                    '$votes',
                    1 // log10(1)=0
                  ]
                }
              },
              100
            ]
          }
        }
      },

      {
        $addFields: {
          total_score: {
            $add: [
              { $multiply: ['$genre_score',    wg ] },
              { $multiply: ['$director_score', wd ] },
              { $multiply: ['$actor_score',    wa ] },
              { $divide:   [{ $ifNull: ['$rating', 0] }, 20 ] },
              { $ifNull:   ['$votes_bonus', 0] }
            ]
          }
        }
      },

      { $sort: { total_score: -1, rating: -1, votes: -1 } },
      { $limit: limit },
      { $project: {
          _id: 1, title: 1, release_year: 1, rating: 1, votes: 1, genres: 1, directors: 1,
          top_cast: { $slice: ['$cast', 3] },
          total_score: { $round: ['$total_score', 4] }
      }}
    ];

    const recs = await Movies.aggregate(pipeline).toArray();
    res.json(recs);
  } catch (err) {
    console.error('recommend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- autocomplete actors ----------
app.get('/api/actors', async (req, res) => {
  const q = (req.query.q || '').trim();
  const stages = [{ $unwind: '$cast' }];
  if (q) stages.push({ $match: { cast: { $regex: q, $options: 'i' } } });
  stages.push(
    { $group: { _id: '$cast', films: { $sum: 1 } } },
    { $sort: { films: -1, _id: 1 } },
    { $limit: 30 }
  );
  const list = await Movies.aggregate(stages).toArray();
  res.json(list);
});

// ---------- analytics ----------
app.get('/api/analytics/actor-collab', async (req, res) => {
  try {
    const input = (req.query.name || '').trim();
    const strict = req.query.strict === '1';
    if (!input) return res.status(400).json({ error: 'name required' });

    let candidate = null;
    if (strict) {
      candidate = input;
    } else {
      let arr = await Movies.aggregate([
        { $unwind: '$cast' },
        { $match: { cast: { $regex: `^${input}$`, $options: 'i' } } },
        { $group: { _id: '$cast', films: { $sum: 1 } } },
        { $sort: { films: -1 } },
        { $limit: 1 }
      ]).toArray();
      if (arr.length) candidate = arr[0]._id;
      if (!candidate) {
        arr = await Movies.aggregate([
          { $unwind: '$cast' },
          { $match: { cast: { $regex: input, $options: 'i' } } },
          { $group: { _id: '$cast', films: { $sum: 1 } } },
          { $sort: { films: -1 } },
          { $limit: 1 }
        ]).toArray();
        if (arr.length) candidate = arr[0]._id;
      }
    }

    if (!candidate) return res.json({ canonical: null, data: [] });

    const out = await Movies.aggregate([
      { $match: { cast: candidate } },
      { $project: { cast: 1, rating: 1 } },
      { $unwind: '$cast' },
      { $match: { cast: { $ne: candidate } } },
      { $group: { _id: '$cast', collaborations: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
      { $sort: { collaborations: -1, avgRating: -1, _id: 1 } },
      { $limit: 50 }
    ]).toArray();

    res.json({ canonical: candidate, data: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/director-specialists', async (req, res) => {
  const minShare = req.query.minShare ? Number(req.query.minShare) : 0.6;
  const minFilms = req.query.minFilms ? Number(req.query.minFilms) : 3;
  const out = await Movies.aggregate([
    { $unwind: '$directors' },
    { $unwind: '$genres' },
    { $group: { _id: { director: '$directors', genre: '$genres' }, count: { $sum: 1 } } },
    { $group: {
        _id: '$_id.director',
        byGenre: { $push: { genre: '$_id.genre', count: '$count' } },
        total: { $sum: '$count' }
    }},
    { $project: {
        _id: 0,
        director: '$_id',
        byGenre: 1,
        total: 1,
        top: { $max: '$byGenre.count' }
    }},
    { $project: { director: 1, total: 1, byGenre: 1, topShare: { $divide: ['$top', '$total'] } } },
    { $match: { topShare: { $gte: minShare }, total: { $gte: minFilms } } },
    { $sort: { topShare: -1, total: -1, director: 1 } },
    { $limit: 50 }
  ]).toArray();
  res.json(out);
});

app.get('/api/analytics/genre-decade', async (req, res) => {
  const out = await Movies.aggregate([
    { $addFields: { decade: { $multiply: [ { $floor: { $divide: ['$release_year', 10] } }, 10 ] } } },
    { $unwind: '$genres' },
    { $group: { _id: { decade: '$decade', genre: '$genres' }, films: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
    { $sort: { '_id.decade': 1, films: -1, '_id.genre': 1 } },
    { $limit: 500 }
  ]).toArray();
  res.json(out);
});

app.get('/api/analytics/top-pairs', async (req, res) => {
  const minFilms = req.query.minFilms ? Number(req.query.minFilms) : 2;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const out = await Movies.aggregate([
    { $unwind: '$cast' },
    { $unwind: '$directors' },
    { $group: { _id: { actor: '$cast', director: '$directors' }, films: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
    { $match: { films: { $gte: minFilms } } },
    { $sort: { avgRating: -1, films: -1, '_id.actor': 1, '_id.director': 1 } },
    { $limit: limit }
  ]).toArray();
  res.json(out);
});

// ---------- static ----------
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- start ----------
connect().then(() => {
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}).catch(err => {
  console.error('Mongo connect error:', err);
  process.exit(1);
});
