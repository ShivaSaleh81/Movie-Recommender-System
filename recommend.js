use('movieDB');

const USERNAME = 'Shiva'; // ← change if you want a different user

const user = db.users.findOne({ username: USERNAME });
if (!user) { throw new Error(`User '${USERNAME}' not found. Create one in db.users first.`); }

const watchedIds = (user.watched_movies && user.watched_movies.length ? user.watched_movies : (user.seen_movies || [])) || [];
print(`User '${USERNAME}' has ${watchedIds.length} watched movies.`);

// Build user preference weights from watched movies
const watchedMovies = watchedIds.length
  ? db.movies.find({ _id: { $in: watchedIds } }, { genres: 1, directors: 1, cast: 1 }).toArray()
  : [];

function tally(arrs) {
  const counts = Object.create(null);
  for (const a of arrs) {
    if (!Array.isArray(a)) continue;
    for (const x of a) {
      if (x == null) continue;
      counts[x] = (counts[x] || 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
}

const user_genre_weights    = tally(watchedMovies.map(m => m.genres));
const user_director_weights = tally(watchedMovies.map(m => m.directors));
const user_actor_weights    = tally(watchedMovies.map(m => m.cast));

// Aggregation pipeline:
// total_score = 0.4*genre + 0.25*director + 0.15*actor + rating/20 + log10(votes)/100
const pipeline = [
  // 1) Exclude already-watched movies
  { $match: { _id: { $nin: watchedIds } } },

  // 2) Compute match scores by summing the user's weights over the movie's fields
  {
    $addFields: {
      genre_score: {
        $sum: {
          $map: {
            input: { $ifNull: ['$genres', []] },
            as: 'g',
            in: {
              $ifNull: [
                { $getField: { field: '$$g', input: { $literal: user_genre_weights } } },
                0
              ]
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
              $ifNull: [
                { $getField: { field: '$$d', input: { $literal: user_director_weights } } },
                0
              ]
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
              $ifNull: [
                { $getField: { field: '$$a', input: { $literal: user_actor_weights } } },
                0
              ]
            }
          }
        }
      }
    }
  },

  // 3) Compute total score
  {
    $addFields: {
      total_score: {
        $add: [
          { $multiply: ['$genre_score',    0.4 ] },
          { $multiply: ['$director_score', 0.25] },
          { $multiply: ['$actor_score',    0.15] },
          { $divide:   ['$rating',         20   ] },
          { $divide:   [{ $log10: { $ifNull: ['$votes', 1] } }, 100] }
        ]
      }
    }
  },

  // 4) Sort and limit
  { $sort: { total_score: -1, rating: -1, votes: -1 } },
  { $limit: 20 },

  // 5) Clean output
  {
    $project: {
      _id: 1,
      title: 1,
      release_year: 1,
      rating: 1,
      votes: 1,
      genres: 1,
      directors: 1,
      top_cast: { $slice: ['$cast', 3] },
      total_score: { $round: ['$total_score', 4] }
    }
  }
];

const recs = db.movies.aggregate(pipeline).toArray();
print(`\n🎯 Top ${recs.length} recommendations for '${USERNAME}':\n`);
for (const r of recs) {
  print(`- ${r.title} (${r.release_year})  ★${r.rating}  votes:${r.votes}  score:${r.total_score}`);
}
