# 🎬 Movie Recommender System

A content-based movie recommendation engine backed by **MongoDB** and served through an **Express.js** REST API, with a Vanilla JS + Tailwind CSS frontend.

---

## ✨ Features

- **Personalized Recommendations** — scores every unseen movie using a weighted formula based on the user's watched history (genres, directors, cast) plus global quality signals (rating, vote count)
- **User Management** — username-based login; profiles are created on first use
- **Watched List** — search movies, add/remove from your personal watched list
- **Analytics Dashboard** — four admin-level reports:
  - Director–Genre Specialists
  - Actor Collaboration Network
  - Genre Popularity by Decade
  - Top Actor–Director Pairs
- **Actor Autocomplete** — live suggestions while typing an actor name
- **CSV Export** — export recommendations or analytics results to CSV

---

## 🧮 Recommendation Formula

For each unwatched movie, the system computes:

```
total_score = 0.4 × genre_score
            + 0.25 × director_score
            + 0.15 × actor_score
            + rating / 20
            + log10(votes) / 100
```

`genre_score`, `director_score`, and `actor_score` are the sum of the user's normalized preference weights (derived from their watched history) over the movie's corresponding fields.

Weights `wg`, `wd`, and `wa` are adjustable from the UI.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [MongoDB Community](https://www.mongodb.com/try/download/community) (running locally on port 27017)
- `mongosh` CLI

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/movies-project.git
cd movies-project

# 2. Install dependencies
npm install

# 3. Create indexes in MongoDB
mongosh --quiet --eval '
  use("movieDB");
  db.movies.createIndex({ title: 1 });
  db.movies.createIndex({ genres: 1 });
  db.movies.createIndex({ directors: 1 });
  db.movies.createIndex({ cast: 1 });
'

# 4. Load the dataset
node load-movies-node.js

# 5. Start the server
node server.js
# → http://localhost:3000
```

### Environment Variables

| Variable    | Default                        | Description              |
|-------------|--------------------------------|--------------------------|
| `MONGO_URI` | `mongodb://localhost:27017`    | MongoDB connection string |
| `DB`        | `movieDB`                      | Database name            |
| `PORT`      | `3000`                         | HTTP server port         |

---

## 🔌 API Reference

### Auth & Movies

| Method | Endpoint                  | Body / Query              | Description                        |
|--------|---------------------------|---------------------------|------------------------------------|
| POST   | `/api/login`              | `{ username }`            | Login or create user               |
| GET    | `/api/search?q=`          | `q` — title substring     | Search movies (case-insensitive)   |
| GET    | `/api/watched?username=`  | —                         | List user's watched movies         |
| POST   | `/api/watched/add`        | `{ username, movieId }`   | Add movie to watched list          |
| POST   | `/api/watched/remove`     | `{ username, movieId }`   | Remove movie from watched list     |

### Recommendations

```
GET /api/recommend?username=Shiva&minYear=2000&minVotes=10000&wg=0.4&wd=0.25&wa=0.15
```

| Param      | Default | Description                        |
|------------|---------|------------------------------------|
| `username` | —       | Required                           |
| `minYear`  | none    | Filter movies released after year  |
| `minVotes` | none    | Filter movies with minimum votes   |
| `wg`       | `0.4`   | Genre weight                       |
| `wd`       | `0.25`  | Director weight                    |
| `wa`       | `0.15`  | Actor weight                       |

### Analytics

| Endpoint                                      | Description                              |
|-----------------------------------------------|------------------------------------------|
| `GET /api/analytics/director-specialists`     | Directors who focus on a single genre    |
| `GET /api/analytics/actor-collab?name=`       | Co-stars of a given actor                |
| `GET /api/analytics/genre-decade`             | Genre film count & avg rating by decade  |
| `GET /api/analytics/top-pairs`                | Actor–Director pairs by avg rating       |

---

## 📊 Sample Queries (mongosh)

```js
// Genre distribution
db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Top directors (≥3 films)
db.movies.aggregate([
  { $unwind: "$directors" },
  { $group: { _id: "$directors", films: { $sum: 1 }, avgRating: { $avg: "$rating" } } },
  { $match: { films: { $gte: 3 } } },
  { $sort: { avgRating: -1 } }
])
```

Full query library is in [`queries.js`](./queries.js).
