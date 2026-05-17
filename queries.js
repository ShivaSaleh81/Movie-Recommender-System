// queries.js (mongosh-friendly, no backticks)

// Polyfill for legacy printjsononeline (not present in mongosh)
if (typeof printjsononeline !== 'function') {
  globalThis.printjsononeline = function (obj) {
    try { print(EJSON.stringify(obj, { relaxed: true })); }
    catch (e) { print(JSON.stringify(obj)); }
  };
}

// Helper to pretty-print the first N results of any array
function show(arr, n) {
  n = (typeof n === 'number') ? n : 10;
  (arr || []).slice(0, n).forEach(function (x, i) {
    var out = { i: i + 1 };
    for (var k in x) out[k] = x[k];
    printjsononeline(out);
  });
}

use('movieDB');

// ----------------- Basic, case-insensitive title search -----------------
function searchByTitle(q) {
  return db.movies.find(
    { title: { $regex: q, $options: 'i' } },
    { title: 1, release_year: 1 }
  ).limit(20).toArray();
}

// ----------------- Show watched movies for a user -----------------
function watchedMovies(username) {
  var u = db.users.findOne({ username: username });
  if (!u) throw new Error("User '" + username + "' not found.");
  var ids = (u.watched_movies && u.watched_movies.length) ? u.watched_movies : (u.seen_movies || []);
  if (!ids || !ids.length) return [];
  return db.movies.find(
    { _id: { $in: ids } },
    { title: 1, release_year: 1 }
  ).toArray();
}

// ----------------- Insert, add/remove watched helpers -----------------
function createUser(username, passwordBase64) {
  return db.users.insertOne({
    username: username,
    password: new BinData(0, passwordBase64 || ''),
    watched_movies: []
  });
}

function addWatched(username, movieIdStr) {
  return db.users.updateOne(
    { username: username },
    { $addToSet: { watched_movies: ObjectId(movieIdStr) } }
  );
}

function removeWatched(username, movieIdStr) {
  return db.users.updateOne(
    { username: username },
    { $pull: { watched_movies: ObjectId(movieIdStr) } }
  );
}

// ===================== Initial Queries (گزارش اولیه) =====================

// 1) Genre distribution: count movies per genre (descending)
function genreDistribution() {
  return db.movies.aggregate([
    { $unwind: '$genres' },
    { $group: { _id: '$genres', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } }
  ]).toArray();
}

// 2) Top directors: directors with >= minFilms; show avg rating
function topDirectors(minFilms) {
  minFilms = (typeof minFilms === 'number') ? minFilms : 3;
  return db.movies.aggregate([
    { $unwind: '$directors' },
    { $group: { _id: '$directors', films: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
    { $match: { films: { $gte: minFilms } } },
    { $sort: { avgRating: -1, films: -1, _id: 1 } }
  ]).toArray();
}

/**
 * 3) Movies sharing ≥ minCommon actors with the SPECIFIC movie titled exactly "Speech".
 *    - Finds one "Speech" doc (case-insensitive, trims spaces), preferring highest votes/rating if multiples.
 *    - Excludes the "Speech" doc(s) themselves from results.
 */
function actorConnectionsWithSpeech(minCommon) {
  minCommon = (typeof minCommon === 'number') ? minCommon : 2;

  // exact title "Speech" (case-insensitive), allow stray spaces
  var speechCandidates = db.movies.find(
    { title: { $regex: '^\\s*Speech\\s*$', $options: 'i' } },
    { cast: 1, release_year: 1, rating: 1, votes: 1 }
  ).sort({ votes: -1, rating: -1 }).limit(5).toArray();

  if (!speechCandidates || !speechCandidates.length) {
    throw new Error("Reference movie titled exactly 'Speech' not found.");
  }

  // choose first candidate with cast; else fallback to union of casts
  var speechDoc = null, refCast = [];
  for (var i = 0; i < speechCandidates.length; i++) {
    var c = speechCandidates[i];
    if (c.cast && c.cast.length) { speechDoc = c; refCast = c.cast; break; }
  }
  if (!speechDoc) {
    var u = db.movies.aggregate([
      { $match: { title: { $regex: '^\\s*Speech\\s*$', $options: 'i' } } },
      { $project: { cast: 1 } },
      { $unwind: '$cast' },
      { $group: { _id: null, cast: { $addToSet: '$cast' } } }
    ]).toArray();
    refCast = (u[0] && u[0].cast) ? u[0].cast : [];
    speechDoc = speechCandidates[0]; // any
  }
  if (!refCast.length) {
    throw new Error("Found 'Speech' but it has no cast in dataset.");
  }

  return db.movies.aggregate([
    // Exclude the 'Speech' doc(s) themselves so they don't trivially match
    {
      $match: {
        $and: [
          { _id: { $ne: speechDoc._id } },
          { title: { $not: { $regex: '^\\s*Speech\\s*$', $options: 'i' } } }
        ]
      }
    },
    {
      $project: {
        title: 1,
        release_year: 1,
        rating: 1,
        votes: 1,
        commonActors: {
          $size: {
            $setIntersection: [ { $ifNull: ['$cast', []] }, refCast ]
          }
        }
      }
    },
    { $match: { commonActors: { $gte: minCommon } } },
    { $sort: { commonActors: -1, rating: -1, votes: -1, title: 1 } },
    { $limit: 20 },
    { $project: { _id: 0, title: 1, release_year: 1, rating: 1, votes: 1, commonActors: 1 } }
  ]).toArray();
}

// ===================== Admin / Analytical Queries (داشبورد) =====================

// helper to escape regex special chars
function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A) Director–Genre specialization: directors who mainly focus on one genre
function directorGenreSpecialists(minShare, minFilms) {
  minShare = (typeof minShare === 'number') ? minShare : 0.7;
  minFilms = (typeof minFilms === 'number') ? minFilms : 3;

  return db.movies.aggregate([
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
    { $project: {
        director: 1,
        total: 1,
        byGenre: 1,
        topShare: { $divide: ['$top', '$total'] }
    }},
    { $match: { topShare: { $gte: minShare }, total: { $gte: minFilms } } },
    { $sort: { topShare: -1, total: -1, director: 1 } }
  ]).toArray();
}

// B) Actor collaboration network around a given name (default: 'Henry Robert')
function actorCollabWith(name) {
  name = name || 'Henry Robert';
  // choose canonical casing if needed
  var exactAny = db.movies.findOne({ cast: name }, { _id: 1 });
  var canonical = name;
  if (!exactAny) {
    var pat = '^' + _escapeRegex(name) + '$';
    var best = db.movies.aggregate([
      { $unwind: '$cast' },
      { $match: { cast: { $regex: pat, $options: 'i' } } },
      { $group: { _id: '$cast', films: { $sum: 1 } } },
      { $sort: { films: -1, _id: 1 } },
      { $limit: 1 }
    ]).toArray()[0];
    if (best && best._id) canonical = best._id;
  }

  return db.movies.aggregate([
    { $match: { cast: canonical } },
    { $project: { cast: 1, rating: 1 } },
    { $unwind: '$cast' },
    { $match: { cast: { $ne: canonical } } },
    { $group: { _id: '$cast', collaborations: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
    { $sort: { collaborations: -1, avgRating: -1, _id: 1 } }
  ]).toArray();
}

// C) Genre popularity over decades
function genrePopularityByDecade() {
  return db.movies.aggregate([
    { $addFields: { decade: { $multiply: [ { $floor: { $divide: ['$release_year', 10] } }, 10 ] } } },
    { $unwind: '$genres' },
    { $group: {
        _id: { decade: '$decade', genre: '$genres' },
        films: { $sum: 1 },
        avgRating: { $avg: '$rating' }
    }},
    { $sort: { '_id.decade': 1, films: -1, '_id.genre': 1 } }
  ]).toArray();
}

// D) Actor–Director pairs with highest average ratings
function topActorDirectorPairs(minFilms, limit) {
  minFilms = (typeof minFilms === 'number') ? minFilms : 2;
  limit = (typeof limit === 'number') ? limit : 20;

  return db.movies.aggregate([
    { $unwind: '$cast' },
    { $unwind: '$directors' },
    { $group: {
        _id: { actor: '$cast', director: '$directors' },
        films: { $sum: 1 },
        avgRating: { $avg: '$rating' }
    }},
    { $match: { films: { $gte: minFilms } } },
    { $sort: { avgRating: -1, films: -1, '_id.actor': 1, '_id.director': 1 } },
    { $limit: limit }
  ]).toArray();
}
