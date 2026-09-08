import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-instagram-feed',
  title: 'Design an Instagram-style feed',
  summary:
    'Fan-out on write is right for almost everyone and catastrophic for the few accounts with millions of followers — so the design is a hybrid, and the interesting work is deciding where the boundary sits and what happens at it.',
  phase: 'hld',
  module: 'core-designs',
  position: 47,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['fan-out', 'celebrity-problem', 'feed-cache', 'ranking', 'pagination'],
  prerequisites: ['h-whatsapp'],
  resources: [
    {
      key: 'twitter-timelines-scale',
      tier: 'must',
      note: 'The canonical published treatment of timeline fan-out, including the hybrid for high-follower accounts. Read it for the numbers behind the write-amplification argument.',
    },
    {
      key: 'facebook-tao',
      tier: 'must',
      note: 'The graph store beneath a social feed: objects and associations, optimised for read-heavy traversal. Read it for how the follower graph itself is served, which the feed design assumes.',
    },
    {
      key: 'facebook-memcache',
      tier: 'must',
      note: 'Read the sections on lease-based cache fills and on the thundering-herd mitigations. A feed is almost entirely cache, so its failure modes are cache failure modes.',
    },
    {
      key: 'redis-data-types',
      tier: 'good',
      note: 'Sorted sets are the feed cache. Read the sorted-set operations with the trimming and pagination requirements in mind.',
    },
    {
      key: 'aws-caching-challenges',
      tier: 'good',
      note: 'Read it for the cold-cache and stampede sections. A feed cache that is lost must be rebuilt by fan-out on read, which is the failure this design must survive.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'advanced',
      note: 'Read it as a note on position bias in ranked lists. It is about language models and the finding — that position dominates attention — applies directly to feed ranking and to what a ranking change actually changes.',
    },
  ],

  intuition: {
    body: `The feed problem is one arithmetic question with two answers, and the whole design is about which one you use and when.

**Fan-out on write.** When someone posts, immediately insert the post id into every follower's precomputed feed list. Reading a feed is then one lookup of a sorted list — cheap and fast, which matters because reads vastly outnumber writes.

**Fan-out on read.** Store the post once. When someone opens their feed, look up who they follow, fetch each of those accounts' recent posts, and merge. Writing is trivial; reading is expensive.

**The arithmetic that decides it:**

\`\`\`
Read-to-write ratio for a social feed: roughly 100:1
So: do the expensive work on the write path.
→ Fan-out on write.
\`\`\`

**And the arithmetic that breaks it:**

\`\`\`
An account with 50 million followers posts once.
Fan-out on write: 50 million list insertions from one action.
At a sustainable 500,000 insertions/second, that is 100 seconds
of the entire system's fan-out capacity for one post.
\`\`\`

**One post starving every other post for a minute and a half.** That is the celebrity problem, and it is not a tail case to be tolerated — a handful of accounts posting concurrently would consume all capacity indefinitely.

So the answer is a hybrid: **fan-out on write for ordinary accounts, fan-out on read for the few with enormous followings.** A user's feed is then a merge of their precomputed list and a live query over the celebrities they follow.

Two further ideas shape the rest.

**Ranking and serving are different systems.** A ranked feed is not "recent posts sorted by score" — computing a score requires features about the viewer, the post and their relationship, and doing that for 500 candidates at read time is a machine-learning inference problem, not a database query. **So the design splits: retrieval produces candidates cheaply, and ranking scores them.** Conflating the two produces a system that can do neither at scale.

**A feed is almost entirely cache.** The precomputed lists are derived data — reconstructible from posts and the follower graph — so they can live in memory with no durability requirement. **Which means the design's most important failure mode is losing the cache**, and the answer to that is that fan-out on read is not merely a celebrity mechanism; it is also the rebuild path.

The framing to carry: **write-amplification is the constraint, the hybrid boundary is the design decision, and retrieval and ranking are separate systems.**`,
    analogyLimit:
      '"A feed is a sorted list of posts from people you follow" is the read model and hides both hard parts. It hides that maintaining that list costs a write per follower, so one account can consume the entire system\'s capacity; and it hides that a ranked feed is not sorted at all — it is scored by a model over features, which is a different system from the one that retrieves candidates.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds the feed as pure fan-out on write: a post inserts into every follower\'s Redis sorted set, trimmed to 1,000 entries. It works well for a year. Then the product signs a celebrity with 40 million followers. Identify four failures, in order of how quickly they appear.',
      answer: `**Failure 1 — the first post consumes the fan-out capacity, immediately.**

\`\`\`
40 million insertions from one post.
Fan-out workers sustain, say, 500,000 insertions/second.
→ 80 seconds to complete
\`\`\`

**For 80 seconds, every other post's fan-out queues behind it** — or shares capacity with it, so ordinary posts take 80 seconds to appear in followers' feeds instead of under a second. **A product whose core promise is immediacy has broken for everyone because one account posted.**

And it is worse than a single 80-second stall: if the celebrity posts three times in five minutes, or if two celebrities post, the backlog never drains.

**Failure 2 — the write amplification is a storage and memory problem too.**

Each insertion is a member added to a sorted set that must be trimmed. 40 million sorted-set operations plus 40 million trims. And the memory: **40 million followers each holding one more entry** is a real memory increase across the Redis fleet from a single action.

At scale this is the dominant cost driver: **fan-out on write means storage proportional to the sum of all followings**, not to the number of posts.

**Failure 3 — the fan-out is not atomic, so the feed is visibly inconsistent.**

The 80-second fan-out means follower 1 sees the post immediately and follower 40,000,000 sees it 80 seconds later. **Two users side by side get different feeds**, and worse, a user who refreshes during the window may see the post appear, then a subsequent refresh hitting a different cache node may not.

*This is not a bug to fix but a property to accept and bound.* Bounding it means capping how long a fan-out may take — which means capping how many followers a fan-out-on-write account may have, which is the hybrid boundary.

**Failure 4 — a follower who has been inactive for a year still receives 40 million-th of the work.**

Most followers of a large account are inactive. Fan-out on write inserts into all of their feeds, and **the vast majority of that work produces a list nobody reads.**

*This is the observation that makes the hybrid affordable*, and it generalises beyond celebrities: **fan-out on write should target active users, not all followers.** An inactive user's feed is rebuilt on read when they return, which is exactly the fan-out-on-read path.

**The fix, and the boundary decision.**

\`\`\`
if follower_count < THRESHOLD:
    fan out on write to ACTIVE followers only
else:
    do not fan out at all; the post is fetched on read
\`\`\`

**Where does THRESHOLD sit?** It is a capacity decision, and it can be derived:

\`\`\`
Acceptable fan-out completion time: 5 seconds
Sustainable fan-out rate:           500,000 insertions/second
→ THRESHOLD ≈ 2.5 million followers... but that is per post,
  assuming the whole system's capacity for one post.

Allow one post at most 2% of fan-out capacity:
→ 500,000 × 5 s × 0.02 = 50,000 followers
\`\`\`

**A threshold around 50,000 to 100,000 followers**, and the reasoning is that no single post may consume more than a small fraction of the system's fan-out capacity. **That derivation is the answer** — a threshold chosen without it is a guess.

**And on the read side**, a user following any number of celebrities does:

\`\`\`
1. Read their precomputed feed (one sorted-set range).
2. For each celebrity they follow (usually 0–20), read that
   account's recent posts — a small, heavily-cached query.
3. Merge by score, paginate, return.
\`\`\`

**Step 2 is cheap because celebrity post lists are shared.** One cached list per celebrity serves all 40 million followers, so the read cost is a handful of cache hits rather than a fan-out.

**In order of appearance: capacity starvation within seconds of the first post, then memory growth, then visible inconsistency during the window, then the realisation that most of the work was wasted on inactive users.** The last is the least urgent and the most useful, because it makes both halves of the hybrid cheaper.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A user can post an image with a caption
A user can follow and unfollow another user
A user sees a feed of posts from accounts they follow
A user can like and comment on a post
A user can view a specific account's posts
The feed is ranked, not strictly chronological
A user can paginate backwards through their feed
\`\`\`

**The clarifying questions that change this design:**

**Is the feed chronological or ranked?** *Ranked.* This is decisive: a chronological feed is a merge of sorted lists and can be served entirely from a cache; a ranked feed needs candidate retrieval plus scoring, which is a second system.

**Are there accounts with millions of followers?** *Yes, up to 400 million.* Forces the hybrid. Answering no would make pure fan-out on write correct and this a much simpler design.

**Must a post appear in followers' feeds immediately?** *Within seconds for ordinary accounts; a longer delay is acceptable for very large accounts.* **This asymmetry is what licenses the hybrid** — if immediacy were required for everyone, neither approach would work.

**How far back can a user scroll?** *Around 1,000 posts.* Bounds the precomputed list size, which bounds memory.

**Is the feed the same on every device?** *Approximately — ranking may differ slightly between requests.* A strict guarantee would forbid caching ranked results.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Feed load latency | p99 under 200 ms | Precomputed lists, in-memory; no ranking from scratch |
| Post visibility (ordinary accounts) | Under 5 s | Bounded fan-out, hence the threshold |
| Availability | 99.99% for feed reads | Feed must serve degraded if ranking is down |
| Consistency | Eventual; a post may appear at slightly different times | Permits asynchronous fan-out |
| Scale | 500 M DAU, 100 M posts/day | See estimation |
| Durability | Posts never lost; feeds are derived and disposable | Posts durable, feed cache not |

**Out of scope:** the ranking model itself (assume a scoring service exists), media storage and delivery (the blob-storage lesson), stories, and direct messages.

## Step 2 — Estimation

\`\`\`
Users:          2 billion, 500 million daily active
Posts:          100 million/day → 1,000/s average, 3,000/s peak
Feed loads:     500 M × 10/day = 5 billion/day
                → 50,000/s average, 150,000/s peak
Read:write:     5e9 / 1e8 = 50:1
\`\`\`

**Fan-out volume, which is the number that shapes everything:**

\`\`\`
Average followers: 200
Fan-out on write to all followers:
  1,000 posts/s × 200 = 200,000 insertions/s average
                        600,000/s peak
\`\`\`

**Affordable — until the distribution is considered.** Follower counts follow a power law, so the *average* of 200 is not the cost driver:

\`\`\`
99% of accounts:      < 5,000 followers
0.9%:                 5,000–100,000
0.1% (2 million):     > 100,000
Top ~1,000 accounts:  > 10 million
\`\`\`

**The top 0.1% of accounts, if fanned out on write, would dominate total fan-out volume** despite being a rounding error in account count. That is the argument for the hybrid stated as arithmetic.

\`\`\`
Active-follower optimisation:
  Assume 25% of followers are active in a 30-day window.
  Fan-out to active only: 600,000/s peak → 150,000/s
\`\`\`

**A 4× reduction from one filter**, and it costs a rebuild-on-return path that the celebrity mechanism already provides.

\`\`\`
Feed cache memory:
  Entry: post_id (8 B) + score (8 B) + overhead ≈ 50 B
  1,000 entries × 500 M active users × 50 B = 25 TB
  → sharded Redis, ~100 nodes at 256 GB
\`\`\`

**25 TB of feed cache is the single largest infrastructure item**, and it is why the list is trimmed to 1,000 and why only active users get one.

\`\`\`
Post storage:
  100 M/day × 1 KB metadata = 100 GB/day → 36 TB/year
  Media is separate (blob store), ~2 MB average
  → 200 TB/day of media, which dwarfs everything else
\`\`\`

**Media is 2,000× the metadata**, which is why media is a separate system and why the feed carries references rather than content.

\`\`\`
Ranking cost:
  150,000 feed loads/s × 500 candidates = 75 million scorings/s
\`\`\`

**75 million model inferences per second is not feasible**, and that number forces the retrieval-and-ranking split plus heavy caching of ranked results. It is the estimate's most important output.

## Step 3 — API design

\`\`\`
POST /posts
  { mediaRef, caption }                    → 201 { postId }

GET  /feed?cursor={c}&limit=20
  → { posts: [{ postId, author, mediaRef, caption,
                likeCount, hasLiked, score }],
      cursor }

GET  /users/{id}/posts?cursor={c}          → the account's own posts
POST /users/{id}/follow                    → 204
POST /posts/{id}/like                      → 204
POST /posts/{id}/comments  { text }        → 201
\`\`\`

**Four decisions worth defending.**

**The cursor is opaque and encodes a ranking position, not an offset or a timestamp.** A ranked feed cannot be paginated by timestamp, because scores are not monotonic in time. And an offset over a ranked list would re-rank on every page and produce duplicates and omissions. **The cursor must encode enough state to continue the same ranked result** — which in practice means a reference to a materialised ranked page, with a short TTL.

**The feed response includes the score.** Not for the client to use, but so the pagination cursor can reference it and so ranking changes are debuggable in production. **A feed that cannot explain why a post was placed where it was is undebuggable.**

**\`hasLiked\` is per viewer**, which means the response is not cacheable publicly — the CDN lesson's conclusion. So feed responses are cached per user with a short TTL, and the shared parts (post metadata, like counts) are cached separately and assembled.

**Posting returns immediately, before fan-out.** The post is durable and the fan-out is asynchronous, so a large-account post does not block on 40 million insertions — which is the same persist-then-deliver inversion as the messaging lesson.

## Step 4 — Data model

\`\`\`sql
-- Posts: the source of truth, durable
posts(
  post_id,                       -- PARTITION KEY: hash(post_id)
  author_id, media_ref, caption,
  created_at, like_count, comment_count, deleted_at
)

-- An account's own posts: the fan-out-on-read source
author_posts(
  author_id,                     -- PARTITION KEY
  created_at DESC, post_id,      -- SORT KEY
  PRIMARY KEY (author_id, created_at, post_id)
)

-- The follower graph, stored in both directions
follows(follower_id, followee_id, created_at)   -- PARTITION: follower_id
followers(followee_id, follower_id, created_at) -- PARTITION: followee_id

-- Follower counts and the hybrid flag
authors(author_id, follower_count, is_large_account, last_post_at)

-- Feed cache: Redis, derived, disposable
feed:{user_id}  → ZSET of (post_id → score), trimmed to 1,000
\`\`\`

**Four decisions, and the graph duplication is the important one.**

**The follower graph is stored twice, in both directions.** \`follows\` partitioned by follower answers "who does this user follow" — needed on the read path for the celebrity merge. \`followers\` partitioned by followee answers "who follows this account" — needed on the write path for fan-out. **Neither partitioning serves both queries**, so the graph is duplicated, which is the denormalisation lesson applied to an edge list.

*The cost:* a follow writes two rows and they must be consistent. **A follow is therefore a transaction, or an outbox-driven pair** — and an inconsistency here means a user who follows someone but never receives their posts, which is invisible until reported.

**\`is_large_account\` is a materialised flag, not a computed comparison.** The fan-out worker must decide the strategy per post without counting followers, so the flag is maintained when the count crosses the threshold. **And crossing it is an event with consequences**, covered in step 6.

**\`author_posts\` exists specifically for fan-out on read**, sorted by recency so "this account's last 50 posts" is a range scan.

**The feed cache has no durable backing.** It is derived from \`posts\` plus the graph, so losing it costs a rebuild rather than data — which is what permits it to be a memory-only store.

## Step 5 — Architecture

\`\`\`
POST /posts
   │
   ▼
Post service ──▶ posts, author_posts (durable)  ──▶ 201 to client
   │
   ▼ (async)
Fan-out dispatcher
   │  reads authors.is_large_account
   ├── ordinary → Fan-out workers ──▶ ZADD to active followers' feeds
   └── large    → nothing (read-path merge handles it)

GET /feed
   │
   ▼
Feed service
   ├─▶ 1. ZREVRANGE feed:{user} → ~300 precomputed candidates
   ├─▶ 2. follows(user) ∩ large accounts → their author_posts
   │       → ~200 more candidates (cached per author)
   ├─▶ 3. merge → ~500 candidates
   ├─▶ 4. Ranking service: score 500 candidates
   ├─▶ 5. hydrate top 20 from posts + like counts + hasLiked
   └─▶ 6. materialise the ranked page, return with a cursor
\`\`\`

**Why fan-out is asynchronous and after the response.** The post is durable before the client sees 201, so fan-out failure delays visibility rather than losing the post. Same inversion as messaging.

**Why the read path has two candidate sources.** Step 1 is the precomputed list; step 2 is the celebrity merge. **A user following no large accounts skips step 2 entirely**, which is the common case — so the hybrid's read cost is paid only by users who follow celebrities.

**Why ranking is a separate service.** 75 million scorings per second at peak, from the estimate. That is a model-serving problem with its own hardware, batching and caching — and it must be able to fail independently, because **a feed that cannot rank must still return something.**

## Step 6 — The deep dive: the hybrid boundary and what happens at it

**The threshold, derived rather than guessed.** From the prediction: no single post may consume more than ~2% of fan-out capacity, giving a threshold around 50,000–100,000 followers. **I would set it at 50,000** and treat it as a tunable capacity parameter rather than a product constant.

**The three things that make the hybrid work.**

**1. Active-follower filtering, on the write side.** Fan out only to followers active in the last 30 days — a 4× reduction from the estimate. An inactive user's feed is empty when they return, and it is rebuilt by fan-out on read for their whole following. **So the rebuild path is needed anyway, and the celebrity mechanism is it.**

**2. Shared caching of large-account post lists, on the read side.** \`author_posts\` for a celebrity is one cached list serving all 40 million followers. **The read cost of a celebrity is a single cache entry, not per-follower work** — which is why fan-out on read is cheap here and expensive for ordinary accounts.

*And the asymmetry is exactly inverted from fan-out on write*, which is why the hybrid works: the accounts that are expensive to write are cheap to read, because their content is shared by definition.

**3. A bounded number of large accounts followed per user.** A user following 500 celebrities would need 500 read-path queries. In practice the distribution is favourable — most users follow few — but **it must be bounded explicitly**: cap the read-path merge at the 20 most-recently-active large accounts and rely on the precomputed list for the rest. **Losing some celebrity posts for a user following hundreds is an acceptable degradation; an unbounded read is not.**

**Now the boundary crossing, which is the case people miss.**

An account grows from 49,000 to 51,000 followers and flips to large. **Three problems appear at once.**

**Problem A — its existing posts are in followers' precomputed feeds, and its new posts are not.** So the account's timeline appears to stop from the follower's perspective, unless the read path also merges it. *Fix:* the read path merges large accounts unconditionally, and duplicates are removed by post id during the merge. **The merge must be a union with deduplication, not a concatenation.**

**Problem B — flapping.** An account hovering at the threshold flips repeatedly, alternating strategies and producing inconsistent visibility. *Fix:* hysteresis — become large at 50,000 and revert only below 30,000. **The asymmetric threshold from the load-balancing lesson**, applied here.

**Problem C — the transition post.** A post made at the moment of transition may be partially fanned out. *Fix:* the strategy is decided once, at post time, and recorded on the post. **The post's own record says how it was distributed**, so the read path knows whether to expect it in the precomputed list.

**Ranking, and how it stays affordable.**

The estimate said 75 million scorings per second is infeasible. Three things bring it down:

\`\`\`
1. Cache the ranked page. A user loading their feed twice in a minute
   gets the same materialised page. Hit rate ~60%.
   → 150,000 loads/s becomes ~60,000 ranking requests/s
2. Rank in two stages: a cheap linear model prunes 500 candidates
   to 100, then the expensive model scores 100.
   → 60,000 × 100 = 6 million expensive scorings/s
3. Batch scorings across requests, which model servers require anyway
   for throughput.
\`\`\`

**From 75 million to 6 million by caching and two-stage ranking**, and the two-stage structure is the standard retrieval-and-ranking split — the same shape as the retrieval lesson's cheap-recall-then-expensive-rerank.

**And ranking must degrade.** If the ranking service is unavailable, the feed service falls back to **reverse-chronological order over the same candidates.** Worse, and instantly available, and it means a ranking outage is a quality degradation rather than a feed outage. **This path must be exercised continuously** — the timeouts lesson's warning about fallbacks applies exactly.

## Step 7 — What breaks at 10×

**5 billion DAU, 1 billion posts/day, 1.5 million feed loads/second.**

**Feed cache memory becomes the constraint.** 250 TB. *Fix:* reduce the precomputed list from 1,000 to 200 entries and rely on fan-out on read for deeper scrolling — **scroll depth follows a steep decay, so 200 covers the vast majority of sessions** and the tail pays a slower read.

**The follower graph read becomes hot.** 1.5 million "who do I follow" lookups per second. *Fix:* cache the following list per user, which is small and changes rarely — and it is what makes the celebrity merge affordable.

**Fan-out at 10× exceeds a single dispatcher.** *Fix:* partition the dispatcher by author id; it is embarrassingly parallel.

**Ranked-page caching becomes the dominant cost saver**, so the cache hit rate is the metric to optimise. A hit rate falling from 60% to 40% increases ranking load by 50%.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Fan-out workers backed up | Posts appear late in feeds | Post is durable; feeds catch up. **The author still sees their post immediately** from \`author_posts\` |
| Feed cache node lost | ~1% of users have no precomputed feed | **Fan out on read for them entirely** — slower, correct, and the rebuild happens lazily |
| Whole feed cache lost | Nobody has a precomputed feed | Every feed load becomes fan-out on read. **Survivable and slow**; this is why the read path must exist for all accounts |
| Ranking service down | Cannot score | **Reverse-chronological fallback** over the same candidates |
| Post service down | Cannot post | Feeds still serve; reads unaffected |
| Follower graph partition down | Cannot resolve following | Serve the precomputed feed only; celebrity merge omitted |
| Large-account flag wrong (too low) | One post triggers 40 M insertions | Fan-out dispatcher should reject a fan-out above a hard cap regardless of the flag |

**Three rows carry the content.**

**Losing the entire feed cache is survivable**, because fan-out on read exists for the celebrity case and generalises to a rebuild path. **A design with only fan-out on write has no answer here** — which is a second, independent reason for the hybrid.

**The author sees their own post immediately** even when fan-out is backed up, because their own timeline reads \`author_posts\` directly. **Getting this wrong is the most visible possible bug**: a user posts and cannot see it.

**A hard cap in the dispatcher** protects against a stale or wrong \`is_large_account\` flag. **The flag is an optimisation; the cap is the safety mechanism**, and relying on the flag alone means one bad row can consume the fan-out fleet.

## Step 9 — Defending it

**"I chose a hybrid because the arithmetic forces it.** A 50:1 read-to-write ratio says do the work on write, and a 40-million-follower account says one post would consume the whole fan-out capacity for 80 seconds. Neither approach alone works, so the boundary is the design decision — and I derived it from capacity: no single post may take more than about 2% of fan-out throughput, giving roughly 50,000 followers.

**The hybrid works because the asymmetry inverts.** Accounts that are expensive to fan out on write are cheap on read, since one cached post list serves all their followers. That is not a coincidence — it is the same property (a large shared audience) seen from two sides.

**I filtered fan-out to active followers**, a 4× reduction, and the rebuild path it requires is the same read-path mechanism the celebrities already needed.

**I separated retrieval from ranking**, because 75 million scorings per second is not feasible. Ranked-page caching plus two-stage ranking brings it to 6 million, and ranking degrades to reverse-chronological so an outage costs quality rather than availability.

**What I gave up:** feeds are eventually consistent and a post appears at slightly different times for different followers; a user following hundreds of large accounts sees only the most recent 20 merged; scroll depth beyond the precomputed list is slower; and the follower graph is stored twice, so a follow is a transaction.

**What would make me revisit it:** if the feed had to be strictly chronological, ranking disappears and the whole thing becomes a merge of sorted lists — much simpler. And if accounts could have a billion followers with a real-time requirement, even fan-out on read would need a broadcast mechanism rather than a per-account list."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'hybrid',
      title: 'The hybrid: two candidate sources, one merge',
      caption:
        'Step through it. The asymmetry is the point — accounts expensive to fan out on write are cheap on read, because a large shared audience means one cached list serves everyone.',
      nodes: [
        { id: 'post', label: 'POST /posts', kind: 'client', x: 0, y: 190, detail: 'Returns 201 as soon as the post is durable in `posts` and `author_posts`. Fan-out is asynchronous, so a 40-million-follower post does not block the response.' },
        { id: 'disp', label: 'Fan-out dispatcher', kind: 'service', x: 180, y: 190, detail: 'Reads `authors.is_large_account` and chooses a strategy — recorded on the post, so the read path knows how it was distributed. Also enforces a hard cap regardless of the flag.' },
        { id: 'small', label: 'Ordinary: ZADD to active followers', kind: 'service', x: 390, y: 90, detail: 'Under 50,000 followers, and only those active in 30 days — a 4× reduction. An inactive user\'s feed is rebuilt on return by the read path.' },
        { id: 'large', label: 'Large: no fan-out at all', kind: 'note', x: 390, y: 290, detail: 'Above the threshold, nothing is written. 40 million insertions would take 80 seconds of the whole system\'s fan-out capacity for one post.' },
        { id: 'cache', label: 'feed:{user} ZSET, 1,000 entries', kind: 'store', x: 600, y: 90, detail: '25 TB across ~100 Redis nodes — the largest infrastructure item. Derived and disposable: losing it costs a rebuild, not data.' },
        { id: 'read', label: 'GET /feed', kind: 'client', x: 600, y: 380, detail: 'Reads the precomputed list, then merges the large accounts this user follows — capped at the 20 most recently active, because an unbounded read is not acceptable.' },
        { id: 'merge', label: 'Union + dedup → ~500 candidates', kind: 'service', x: 790, y: 190, detail: 'A union with deduplication by post id, not a concatenation — because an account that crossed the threshold has old posts in the precomputed list and new ones only on the read path.' },
        { id: 'rank', label: 'Two-stage ranking', kind: 'service', x: 980, y: 130, detail: 'A cheap model prunes 500 to 100, then the expensive model scores 100. With ~60% ranked-page cache hits, this takes 75 million scorings/second down to 6 million.' },
        { id: 'fallback', label: 'Fallback: reverse-chronological', kind: 'note', x: 980, y: 280, detail: 'If ranking is unavailable, order the same candidates by recency. A ranking outage becomes a quality degradation rather than a feed outage — and this path must be exercised continuously.' },
      ],
      edges: [
        { id: 'i1', source: 'post', target: 'disp', kind: 'async' },
        { id: 'i2', source: 'disp', target: 'small', kind: 'control' },
        { id: 'i3', source: 'disp', target: 'large', kind: 'control' },
        { id: 'i4', source: 'small', target: 'cache', kind: 'write' },
        { id: 'i5', source: 'read', target: 'cache', kind: 'read' },
        { id: 'i6', source: 'read', target: 'large', kind: 'read' },
        { id: 'i7', source: 'cache', target: 'merge', kind: 'sync' },
        { id: 'i8', source: 'large', target: 'merge', kind: 'sync' },
        { id: 'i9', source: 'merge', target: 'rank', kind: 'sync' },
        { id: 'i10', source: 'rank', target: 'fallback', kind: 'control' },
      ],
      steps: [
        {
          id: 'hb1',
          title: 'The post is durable before fan-out begins',
          description:
            'Return 201 once `posts` and `author_posts` are written. Fan-out failure then delays visibility rather than losing the post — and the author sees it immediately from their own timeline.',
          nodes: ['post', 'disp'],
          edges: ['i1'],
        },
        {
          id: 'hb2',
          title: 'The strategy is chosen per post, from a flag plus a hard cap',
          description:
            'Under 50,000 followers, insert into active followers\' lists. Above it, write nothing. The flag is an optimisation; the dispatcher\'s hard cap is the safety mechanism against a stale flag.',
          nodes: ['small', 'large'],
          edges: ['i2', 'i3'],
        },
        {
          id: 'hb3',
          title: 'Reads draw from both sources',
          description:
            'The precomputed list, plus a live query over the large accounts this user follows. A user following no celebrities skips the second entirely, so the hybrid\'s read cost is paid only by those who need it.',
          nodes: ['cache', 'read'],
          edges: ['i4', 'i5', 'i6'],
        },
        {
          id: 'hb4',
          title: 'The merge is a union with deduplication',
          description:
            'An account that crossed the threshold has old posts in the precomputed list and new ones only on the read path, so concatenation would duplicate. Deduplicating by post id is required, not defensive.',
          nodes: ['merge'],
          edges: ['i7', 'i8'],
        },
        {
          id: 'hb5',
          title: 'Then rank in two stages, and be able to stop ranking',
          description:
            'Cheap pruning then expensive scoring, with ranked pages cached. And a reverse-chronological fallback, so losing the ranking service costs feed quality rather than the feed.',
          nodes: ['rank', 'fallback'],
          edges: ['i9', 'i10'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'threshold',
      title: 'Deriving the hybrid threshold from capacity',
      caption:
        'The threshold is a capacity decision, not a product constant. Read the middle branch: allowing one post 2% of fan-out throughput is what produces a defensible number.',
      code: `flowchart TB
    A["Read:write ratio 50:1<br/>→ do the work on write<br/>→ **fan out on write**"]
    B["One account has 40 M followers<br/>→ 40 M insertions per post<br/>→ at 500k/s that is **80 seconds**<br/>of total fan-out capacity"]

    A --> C["**Both are true, so:<br/>where is the boundary?**"]
    B --> C

    C --> D["Naive: 'a few million followers'<br/>= one post may consume<br/>the whole system for 5 s"]
    C --> E["**Derived: no single post may take<br/>more than ~2% of capacity**<br/>500,000/s × 5 s × 0.02<br/>= **50,000 followers**"]

    E --> F["Plus hysteresis:<br/>large at 50,000,<br/>revert below 30,000 —<br/>or an account at the<br/>boundary flaps"]
    E --> G["Plus a hard cap in the<br/>dispatcher, so a stale flag<br/>cannot consume the fleet"]

    E --> H["**And the asymmetry inverts:**<br/>expensive to write = cheap to read,<br/>because one cached post list<br/>serves all 40 M followers"]

    style D fill:#2a1a1a,stroke:#a04848
    style E fill:#17272a,stroke:#35897e
    style H fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['twitter'],
    body: `Twitter's published timeline architecture is the canonical reference, and three of its findings are worth extracting because they were arrived at empirically.

**Fan-out on write was chosen deliberately, from the read-to-write ratio.** Timeline reads vastly outnumber tweets, so precomputing timelines puts the cost where the traffic is not. The published figures — hundreds of thousands of timeline insertions per second at steady state — are the same order as this design's estimate, which is a useful check.

**The high-follower exception was added because pure fan-out on write failed.** The reported behaviour is that accounts above a follower threshold are excluded from fan-out and merged at read time. **That is the hybrid, and it was a retrofit rather than an original design** — which is the most instructive part: the arithmetic that forces the hybrid only becomes visible once a very large account exists.

**Timelines are held in memory and are explicitly disposable.** Reconstructible from tweets and the follow graph, so no durability requirement — and the reported recovery mechanism for a lost timeline is exactly to rebuild it from the source. **Which is the observation that the celebrity read path and the cache-rebuild path are the same mechanism.**

**And a fourth thing, from the operational reporting: the write path is bounded by the slowest fan-out.** A tweet is not "delivered" until every target timeline has it, and monitoring that distribution — rather than the average — is what reveals a large-account fan-out starving ordinary ones.

**Three transferable lessons.**

**Compute the fan-out arithmetic before choosing a strategy.** The read-to-write ratio picks fan-out on write; the follower distribution's tail picks the hybrid. **Both numbers are needed, and the second is the one candidates omit.**

**The threshold is a capacity parameter.** Derive it from what fraction of fan-out throughput a single post may consume, and treat it as tunable rather than as a product decision.

**A precomputed feed is a cache, so design its loss.** The rebuild path is fan-out on read, which means fan-out on read must exist for all accounts — not only for celebrities.

**Where the reference does not transfer.** Twitter's timeline was chronological for most of its history, so the ranking-and-retrieval split and the 75-million-scorings problem are not addressed by it. **That half of this design must be derived**, and it is the half where the arithmetic is most surprising.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, with the arithmetic where it settles the choice.',
    rows: [
      {
        option: 'Pure fan-out on write',
        whenItWins:
          'When no account has a large following. Reads are one sorted-set range, which is exactly what a 50:1 read-heavy workload wants.',
        whenItLoses:
          'The moment one account has millions of followers — a single post consumes the whole fan-out capacity for a minute or more.',
        cost:
          'Write amplification proportional to follower count, and no rebuild path when the cache is lost.',
      },
      {
        option: 'Pure fan-out on read',
        whenItWins:
          'Write-heavy workloads, or when the following graph is tiny.',
        whenItLoses:
          'At a 50:1 read ratio. Every feed load becomes a graph traversal plus a per-followee query and a merge.',
        cost:
          'Read latency proportional to following size, on the path that dominates traffic.',
      },
      {
        option: 'Hybrid with a derived threshold',
        whenItWins:
          'Always at social scale. The accounts expensive to write are cheap to read, because a large shared audience means one cached list serves everyone.',
        whenItLoses:
          'For a user following hundreds of large accounts, where the read-path merge must be capped.',
        cost:
          'Two code paths, a materialised flag with hysteresis, and a merge that must deduplicate.',
      },
      {
        option: 'Fan out to all followers',
        whenItWins:
          'When most followers are active, which is rare.',
        whenItLoses:
          'Most followers of most accounts are inactive, so the majority of the work produces lists nobody reads.',
        cost:
          '4× more fan-out volume and 4× more feed-cache memory than necessary.',
      },
      {
        option: 'Fan out to active followers only',
        whenItWins:
          'Always. A 4× reduction, and the rebuild-on-return path it needs already exists for celebrities.',
        whenItLoses:
          'A returning user waits for a slower first feed load.',
        cost:
          'An activity definition to maintain, and a slower first load after a long absence.',
      },
      {
        option: 'Chronological feed',
        whenItWins:
          'When it is the product. Vastly simpler: a merge of sorted lists, servable entirely from cache, with no model serving at all.',
        whenItLoses:
          'When engagement depends on ranking, which is a product decision rather than a technical one.',
        cost:
          'Whatever ranking was buying.',
      },
      {
        option: 'Ranked feed, single-stage scoring',
        whenItWins:
          'At low volume, where scoring every candidate with the full model is affordable.',
        whenItLoses:
          'At 150,000 feed loads/second — 75 million scorings/second is not feasible.',
        cost:
          'A model-serving fleet sized for an infeasible request rate.',
      },
      {
        option: 'Two-stage ranking with ranked-page caching',
        whenItWins:
          'Always at scale. Caching plus cheap pruning takes 75 million scorings/second to 6 million.',
        whenItLoses:
          'When the cheap first stage prunes a candidate the expensive model would have ranked highly.',
        cost:
          'Recall loss in the pruning stage, and a ranked-page cache whose hit rate becomes a cost driver.',
      },
      {
        option: 'No ranking fallback',
        whenItWins:
          'Nowhere. A ranking outage becomes a feed outage.',
        whenItLoses:
          'Whenever the model-serving tier is unavailable, which is a normal event.',
        cost:
          'The core product surface fails when a quality component fails.',
      },
      {
        option: 'Reverse-chronological fallback',
        whenItWins:
          'Always. A worse feed instantly, so a ranking outage costs quality rather than availability.',
        whenItLoses:
          'If the path is never exercised, in which case it fails during the incident it exists for.',
        cost:
          'A second path that must carry a fraction of live traffic continuously.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Fan out on write: when someone posts, insert the post into every follower\'s feed list."',
      whyWeak:
        'Correct for 99% of accounts and catastrophic for the rest. A 40-million-follower account generates 40 million insertions from one action — roughly 80 seconds of the entire system\'s fan-out capacity, during which every other post\'s visibility is delayed.',
      strongAnswer:
        '"Fan-out on write for ordinary accounts, because the read-to-write ratio is 50:1. But above a threshold the account is excluded from fan-out entirely and merged at read time — because 40 million insertions from one post would consume the fan-out fleet. I would derive the threshold from capacity: no single post may take more than about 2% of fan-out throughput, which gives roughly 50,000 followers."',
    },
    {
      weakAnswer: '"The threshold for large accounts is a few million followers."',
      whyWeak:
        'A guess, and too high by one to two orders of magnitude. At a few million followers, one post still consumes several seconds of the whole system\'s fan-out capacity — so a handful of such accounts posting concurrently starves everything else.',
      strongAnswer:
        '"I would derive it: sustainable fan-out is around 500,000 insertions per second, an acceptable completion time is 5 seconds, and no single post should consume more than a small fraction of capacity — say 2%. That gives 500,000 × 5 × 0.02 = 50,000 followers. And I would add hysteresis, becoming large at 50,000 and reverting below 30,000, so an account at the boundary does not flap between strategies."',
    },
    {
      weakAnswer: '"The read path reads the precomputed feed and appends the celebrity posts."',
      whyWeak:
        'Appending duplicates. An account that crossed the threshold has *old* posts already in followers\' precomputed lists and *new* posts only on the read path — so concatenation shows the old ones twice.',
      strongAnswer:
        '"The merge must be a union with deduplication by post id, not a concatenation. An account that crossed the threshold has posts in both sources, and the transition is not a rare edge case — accounts cross it continuously as they grow. I would also record the fan-out strategy on the post itself, so the read path knows how each post was distributed."',
    },
    {
      weakAnswer: '"Rank the candidates with the model at read time and return the top 20."',
      whyWeak:
        'The arithmetic forbids it. 150,000 feed loads per second at 500 candidates each is 75 million model inferences per second, which is not a feasible serving load at any reasonable cost.',
      strongAnswer:
        '"75 million scorings per second is infeasible, so three things bring it down. Cache the materialised ranked page, which at a 60% hit rate removes most of the load. Rank in two stages: a cheap linear model prunes 500 candidates to 100, then the expensive model scores 100. And batch scorings across requests, which model servers need anyway. That takes it to roughly 6 million expensive scorings per second."',
    },
    {
      weakAnswer: '"The feed cache is in Redis with persistence enabled so it survives a restart."',
      whyWeak:
        'It is derived data — reconstructible from posts and the follower graph — so durability is a cost with no benefit. And persistence does not help with the failure that matters, which is losing capacity rather than losing a process.',
      strongAnswer:
        '"The feed cache is derived and disposable, so no persistence. Losing a node means those users get fan-out on read until their list is rebuilt lazily — slower and correct. And this is a second, independent reason for the hybrid: fan-out on read is not only the celebrity mechanism, it is the cache-rebuild path. A design with only fan-out on write has no answer to losing the cache."',
    },
    {
      weakAnswer: '"If the ranking service is down, the feed returns an error."',
      whyWeak:
        'It makes a quality component a hard dependency of the core product surface. Model-serving tiers are unavailable routinely, and a feed that cannot rank can still return posts.',
      strongAnswer:
        '"Ranking must degrade: if the service is unavailable, order the same candidates reverse-chronologically. That makes a ranking outage a quality degradation rather than a feed outage. And the fallback must carry a small fraction of live traffic continuously — otherwise it is the least-tested code in the system running under the worst conditions, which is how a degradation becomes an outage."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hif-1',
      front: 'Which fan-out strategy does the read-to-write ratio select, and why?',
      back: 'Fan-out on write. At roughly 50:1 read-heavy, the expensive work belongs on the write path so reads are one sorted-set range.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hif-2',
      front: 'What breaks pure fan-out on write?',
      back: 'A 40-million-follower account: one post is 40 million insertions, roughly 80 seconds of total fan-out capacity, delaying every other post.',
      topic: 'celebrity-problem',
    },
    {
      id: 'fc-hif-3',
      front: 'How is the hybrid threshold derived?',
      back: 'From capacity: no single post may consume more than a small fraction of fan-out throughput. 500,000/s × 5 s × 2% ≈ 50,000 followers.',
      topic: 'celebrity-problem',
    },
    {
      id: 'fc-hif-4',
      front: 'Why does the hybrid work at all?',
      back: 'The asymmetry inverts: accounts expensive to fan out on write are cheap on read, because a large shared audience means one cached post list serves all followers.',
      topic: 'celebrity-problem',
    },
    {
      id: 'fc-hif-5',
      front: 'Why fan out to active followers only?',
      back: 'Most followers are inactive, so most of the work produces lists nobody reads. It is a 4× reduction, and the rebuild-on-return path already exists for celebrities.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hif-6',
      front: 'Why must the read-path merge deduplicate?',
      back: 'An account that crossed the threshold has old posts in followers\' precomputed lists and new posts only on the read path, so concatenation shows the old ones twice.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hif-7',
      front: 'Why does the large-account flag need hysteresis?',
      back: 'An account at the boundary would otherwise flip strategies repeatedly. Become large at 50,000 and revert below 30,000.',
      topic: 'celebrity-problem',
    },
    {
      id: 'fc-hif-8',
      front: 'Why does the fan-out dispatcher need a hard cap as well as the flag?',
      back: 'The flag is an optimisation and can be stale or wrong. The cap is the safety mechanism — one bad row must not consume the fan-out fleet.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hif-9',
      front: 'Why is a ranked feed a different system from a chronological one?',
      back: 'Chronological is a merge of sorted lists, servable from cache. Ranked needs candidate retrieval plus model scoring over viewer, post and relationship features.',
      topic: 'ranking',
    },
    {
      id: 'fc-hif-10',
      front: 'What makes ranking affordable?',
      back: 'Ranked-page caching (~60% hits), two-stage ranking (cheap prune to 100, then score), and batching. 75 million scorings/second becomes about 6 million.',
      topic: 'ranking',
    },
    {
      id: 'fc-hif-11',
      front: 'What must happen when the ranking service is unavailable?',
      back: 'Reverse-chronological ordering over the same candidates — a quality degradation rather than a feed outage. And the path must carry live traffic continuously.',
      topic: 'ranking',
    },
    {
      id: 'fc-hif-12',
      front: 'Why is the feed cache stored without persistence?',
      back: 'It is derived from posts and the follower graph, so durability costs without benefit. Losing it means fan-out on read until it is rebuilt lazily.',
      topic: 'feed-cache',
    },
    {
      id: 'fc-hif-13',
      front: 'Why is the follower graph stored twice?',
      back: 'Fan-out needs "who follows this account"; the read path needs "who does this user follow". Neither partitioning serves both, so a follow writes two rows transactionally.',
      topic: 'feed-cache',
    },
    {
      id: 'fc-hif-14',
      front: 'Why can a ranked feed not paginate by timestamp or offset?',
      back: 'Scores are not monotonic in time, and an offset re-ranks each page producing duplicates and omissions. The cursor must reference a materialised ranked page.',
      topic: 'pagination',
    },
  ],

  quiz: [
    {
      id: 'q-hif-1',
      kind: 'scenario',
      prompt:
        'An account with 40 million followers posts. Fan-out sustains 500,000 insertions/second. What happens under pure fan-out on write?',
      options: [
        { id: 'a', label: 'About 80 seconds of the entire system\'s fan-out capacity goes to one post, delaying every other post\'s visibility' },
        { id: 'b', label: 'The insertions are spread over time and nobody notices' },
        { id: 'c', label: 'Redis rejects the writes once the sorted sets are full' },
        { id: 'd', label: 'The post appears immediately for all followers because the insertions are parallel' },
      ],
      correct: ['a'],
      explanation:
        '40 million ÷ 500,000 = 80 seconds. During that window ordinary posts either queue behind it or share reduced capacity, so a product promising immediacy has broken for everyone because one account posted. Parallelism is already reflected in the 500,000/second figure — that is the fleet\'s aggregate rate.',
      difficulty: 'core',
      topic: 'celebrity-problem',
    },
    {
      id: 'q-hif-2',
      kind: 'scenario',
      prompt:
        'A candidate proposes a large-account threshold of "a few million followers". Why is that wrong, and how should it be derived?',
      options: [
        { id: 'a', label: 'Too high by one to two orders — derive it from capacity: no single post above ~2% of fan-out throughput, giving roughly 50,000 followers' },
        { id: 'b', label: 'Too low — the threshold should be based on post frequency rather than follower count' },
        { id: 'c', label: 'Correct, since a few million insertions completes in seconds' },
        { id: 'd', label: 'The threshold should equal the trimmed feed length of 1,000' },
      ],
      correct: ['a'],
      explanation:
        'At a few million followers one post still consumes several seconds of total capacity, so a handful of such accounts posting concurrently starves everything else. Deriving from a capacity share — 500,000/s × 5 s × 2% — gives a defensible number and makes the threshold a tunable parameter rather than a guess.',
      difficulty: 'advanced',
      topic: 'celebrity-problem',
    },
    {
      id: 'q-hif-3',
      kind: 'scenario',
      prompt:
        'An account grows past the threshold and becomes a large account. Why must the read-path merge deduplicate?',
      options: [
        { id: 'a', label: 'Its old posts are already in followers\' precomputed lists while new ones exist only on the read path, so concatenation shows the old ones twice' },
        { id: 'b', label: 'Because Redis sorted sets can contain duplicate members' },
        { id: 'c', label: 'Because the ranking model may score the same post twice' },
        { id: 'd', label: 'Deduplication is unnecessary if the flag is set atomically' },
      ],
      correct: ['a'],
      explanation:
        'The transition leaves the account\'s posts split across both sources, and accounts cross the threshold continuously as they grow — so this is a normal case rather than an edge one. A union with deduplication by post id is required, and recording the fan-out strategy on each post lets the read path reason about where it should be.',
      difficulty: 'advanced',
      topic: 'fan-out',
    },
    {
      id: 'q-hif-4',
      kind: 'scenario',
      prompt:
        '150,000 feed loads/second, 500 candidates each, scored by a model. What does the arithmetic say, and what fixes it?',
      options: [
        { id: 'a', label: '75 million scorings/second, which is infeasible — fixed by ranked-page caching, two-stage ranking, and batching, giving about 6 million' },
        { id: 'b', label: '75 million scorings/second, which is fine with enough GPUs' },
        { id: 'c', label: '150,000 scorings/second, since one inference ranks the whole candidate set' },
        { id: 'd', label: 'The number depends on the model size rather than the request rate' },
      ],
      correct: ['a'],
      explanation:
        'This is the estimate\'s most important output and it forces the retrieval-and-ranking split. A ~60% ranked-page cache hit rate removes most requests; a cheap first stage prunes 500 to 100; and batching is required for model-server throughput anyway. Together they take it to a feasible 6 million.',
      difficulty: 'advanced',
      topic: 'ranking',
    },
    {
      id: 'q-hif-5',
      kind: 'scenario',
      prompt:
        'The entire feed cache is lost. What happens, and what does this reveal about the design?',
      options: [
        { id: 'a', label: 'Every feed load becomes fan-out on read — slow but correct, which is a second independent reason the read path must exist for all accounts' },
        { id: 'b', label: 'Feeds are unavailable until the cache is rebuilt by replaying posts' },
        { id: 'c', label: 'Nothing, because the cache has persistence enabled' },
        { id: 'd', label: 'Only users following large accounts can still load a feed' },
      ],
      correct: ['a'],
      explanation:
        'The feed cache is derived data, so losing it costs a rebuild rather than data — and the rebuild path is fan-out on read. This means a design with only fan-out on write has no answer to cache loss, which is an argument for the hybrid entirely separate from the celebrity problem.',
      difficulty: 'core',
      topic: 'feed-cache',
    },
    {
      id: 'q-hif-6',
      kind: 'multi',
      prompt:
        'Which are true about paginating a ranked feed? Select all that apply.',
      options: [
        { id: 'a', label: 'Timestamp cursors do not work because scores are not monotonic in time' },
        { id: 'b', label: 'Offset pagination re-ranks each page, producing duplicates and omissions' },
        { id: 'c', label: 'The cursor should reference a materialised ranked page with a short TTL' },
        { id: 'd', label: 'Including the score in the response is unnecessary and leaks model internals' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three follow from the feed being scored rather than sorted. The fourth is wrong in practice: the score is needed for the cursor to continue the same ranked result, and a feed that cannot explain why a post was placed where it was is undebuggable in production.',
      difficulty: 'core',
      topic: 'pagination',
    },
  ],

  exercises: [
    {
      id: 'ex-hif-1',
      kind: 'design',
      title: 'Move the threshold and re-derive the design',
      estimatedMinutes: 40,
      prompt: `**Part 1.** Compute the total fan-out volume under three threshold choices, given: 1,000 posts/second, and this follower distribution.

\`\`\`
99.0% of accounts: 500 followers average
0.9% of accounts:  20,000 followers average
0.1% of accounts:  2,000,000 followers average
Posting rate is proportional to follower count^0.3
  (larger accounts post somewhat more, sub-linearly)
\`\`\`

Thresholds to evaluate: **no threshold** (pure fan-out on write), **50,000**, and **500**.

**Part 2.** For each threshold, say what the read path costs for a user following 300 accounts with a typical mix.

**Part 3.** Five consequences of setting the threshold at 500 — that is, fanning out on write for almost nobody.

Then answer:

- Which threshold minimises total work, and is that the right objective?
- What does the follower-count exponent in the posting rate change?
- At what threshold does the design stop being a hybrid, and what does it become?`,
      rubric: [
        'Computes fan-out volume per account tier, weighted by posting rate.',
        'Correctly identifies that the 0.1% tier dominates under no threshold.',
        'Read-path cost computed per threshold for a 300-following user.',
        'Identifies that a threshold of 500 makes reads expensive for everyone.',
        'Part 3 names at least four consequences including cache utility and latency.',
        'Distinguishes minimising total work from minimising read latency.',
        'Addresses the posting-rate exponent\'s effect on the tier weighting.',
        'Identifies the degenerate cases at both extremes.',
      ],
      modelAnswer: `**Part 1 — fan-out volume under three thresholds**

First, distribute the 1,000 posts/second across tiers using the posting-rate weighting.

*Relative posting rate per account*, proportional to \`followers^0.3\`:

\`\`\`
Tier A (500 followers):        500^0.3      ≈ 6.5
Tier B (20,000 followers):     20,000^0.3   ≈ 19.0
Tier C (2,000,000 followers):  2,000,000^0.3 ≈ 78.5
\`\`\`

*Weighted share of posts*, multiplying by each tier's account share:

\`\`\`
Tier A: 0.990 × 6.5  = 6.435
Tier B: 0.009 × 19.0 = 0.171
Tier C: 0.001 × 78.5 = 0.0785
                Total = 6.685

Posts/second per tier:
  Tier A: 1,000 × 6.435/6.685 = 962 posts/s
  Tier B: 1,000 × 0.171/6.685 =  26 posts/s
  Tier C: 1,000 × 0.0785/6.685 = 12 posts/s
\`\`\`

**Note that tier C is 0.1% of accounts and 1.2% of posts** — the sub-linear exponent means large accounts post more but not proportionally more, which matters below.

**Threshold: none (pure fan-out on write)**

\`\`\`
Tier A: 962 × 500       =    481,000 insertions/s
Tier B:  26 × 20,000    =    520,000 insertions/s
Tier C:  12 × 2,000,000 = 24,000,000 insertions/s
                  Total ≈ 25,000,000 insertions/s
\`\`\`

**Tier C is 96% of all fan-out volume from 0.1% of accounts.** And 25 million insertions/second against a sustainable 500,000/second is **50× over capacity** — the system simply cannot do this.

**That single ratio is the whole argument for the hybrid**, expressed as arithmetic rather than as a story about celebrities.

**Threshold: 50,000**

Tier C (2 M followers) is excluded; tiers A and B fan out.

\`\`\`
Tier A:    481,000 insertions/s
Tier B:    520,000 insertions/s
    Total ≈ 1,000,000 insertions/s
\`\`\`

**Still 2× over the 500,000/second capacity** — which is a genuinely useful finding, because it says a 50,000 threshold alone is not sufficient at this distribution.

*Two ways to close the gap:*

**Active-follower filtering at 25%** brings it to 250,000/second — comfortably inside capacity. **This is why the active filter is not an optimisation but a requirement** at this distribution.

**Or lower the threshold to exclude tier B as well**, which is the third case.

**Threshold: 500**

Only accounts under 500 followers fan out on write. Tier A averages 500, so roughly half of tier A qualifies:

\`\`\`
~half of tier A: 481 × 250 ≈ 120,000 insertions/s
Everything else: read path
          Total ≈ 120,000 insertions/s
\`\`\`

**Comfortably inside capacity**, and the cost has moved entirely to reads.

**Part 2 — read-path cost for a user following 300 accounts**

Assume the following mix reflects the population, so of 300 followed accounts:

\`\`\`
~297 in tier A (< 500 followers)
~3 in tier B   (20,000)
~0.3 in tier C (2 M) — call it 1 for a typical engaged user
\`\`\`

**Threshold: none.** Read path is one \`ZREVRANGE\` on the precomputed list. **~1 cache operation.** This is the ideal read, and it is unavailable because the write side is 50× over capacity.

**Threshold: 50,000.** Precomputed list covers tiers A and B; tier C is merged at read time.

\`\`\`
1 × ZREVRANGE (precomputed)
1 × read of the tier-C account's cached post list
+ merge
≈ 2 cache operations
\`\`\`

**Almost as cheap as pure fan-out on write**, because the user follows very few tier-C accounts and those lists are shared and heavily cached. **This is the hybrid's payoff: the read cost is proportional to the number of *large* accounts followed, which is small.**

**Threshold: 500.** Precomputed list covers roughly half of tier A; everything else is merged.

\`\`\`
1 × ZREVRANGE (covers ~148 accounts)
~152 × read of each remaining account's post list
+ merge of ~152 result sets
≈ 153 cache operations, plus a much larger merge
\`\`\`

**Two orders of magnitude more expensive**, on the path that carries 50:1 more traffic than writes. At 150,000 feed loads/second that is **23 million cache operations per second** for candidate retrieval alone — worse than the fan-out volume it was trying to avoid.

**And it is worse than the numbers suggest**, because a tier-A account's post list is *not* shared: it serves 500 followers, so its cache entry has low reuse. **Tier-C lists are cheap to read precisely because 2 million followers share one entry; tier-A lists have no such economy.**

**Part 3 — five consequences of a threshold of 500**

**1. Reads become the bottleneck, and reads are the dominant traffic.** 23 million candidate-retrieval operations per second against a 50:1 read-heavy workload. **The design has moved the cost from the cheap side to the expensive side**, which is the opposite of what the read-to-write ratio dictates.

**2. The feed cache becomes nearly useless.** It covers only accounts under 500 followers, so it contributes a small fraction of candidates. **25 TB of Redis for a partial answer** — and the natural response is to delete it, at which point the design is pure fan-out on read.

**3. Read latency becomes proportional to following size.** A user following 300 accounts does 152 lookups; one following 3,000 does 1,500. **Latency now varies by more than an order of magnitude between users**, and the p99 is set by the most engaged users — exactly the ones you least want to degrade.

**4. Cache hit rates collapse for small-account post lists.** A tier-A account's list serves 500 followers, so it is read rarely and is a poor cache candidate. **The read path's cost estimate above assumed cache hits**; with misses it becomes database queries, and 23 million database reads per second is a different order of problem.

**5. The merge itself becomes expensive.** Merging 152 sorted lists to produce 500 candidates is real CPU per request, at 150,000 requests/second. **This is work that fan-out on write had already done at write time**, once, rather than on every read.

*And a sixth worth naming:* **the design loses its rebuild path.** If almost nothing is fanned out on write, there is no precomputed state to lose — which sounds like a benefit and means the system has no fast path at all, so every read is the slow path permanently.

---

**Which threshold minimises total work, and is that the right objective?**

**Threshold 500 minimises total *write* work** — 120,000 insertions/second versus 1,000,000 at 50,000.

**But it does not minimise total work**, and it is not the right objective anyway.

*Total work at threshold 500:*

\`\`\`
Writes: 120,000 insertions/s
Reads:  150,000 loads/s × 152 lookups = 23,000,000 operations/s
Total:  ~23,100,000 operations/s
\`\`\`

*Total work at threshold 50,000, with active filtering:*

\`\`\`
Writes: 250,000 insertions/s
Reads:  150,000 loads/s × 2 lookups = 300,000 operations/s
Total:  ~550,000 operations/s
\`\`\`

**Threshold 50,000 does 40× less total work.** So the intuition that a lower threshold reduces work is exactly wrong once reads are counted — **because the read-to-write ratio means read-side work is multiplied by 50.**

**And total work is still not the objective.** The objective is **read latency at p99**, because that is what users experience. Writes are asynchronous and invisible; a slow feed load is the product being bad. **So the correct objective is: minimise read cost, subject to write volume fitting in capacity.**

That reframing gives the design rule: **set the threshold as high as write capacity permits.** Higher means more precomputation and cheaper reads; the constraint is fan-out throughput. **50,000 with active filtering is at the boundary of capacity, which makes it the right answer** — and if capacity doubled, the correct response would be to *raise* the threshold, not to keep the spare capacity.

**What does the posting-rate exponent change?**

The exponent 0.3 makes large accounts post *sub-linearly* more. Consider what happens if it were different.

**Exponent 0 (all accounts post equally often):**

\`\`\`
Tier C share of posts: 0.1% → 1 post/s
Tier C fan-out: 1 × 2,000,000 = 2,000,000 insertions/s
Total: ~2.5 million/s
\`\`\`

**Tier C is still 80% of fan-out volume**, so the hybrid is still necessary — the follower count dominates regardless of posting rate.

**Exponent 1 (posting rate proportional to followers):**

\`\`\`
Tier C relative rate: 2,000,000 vs tier A's 500 → 4,000×
Tier C share of posts: 0.001 × 4,000 / (0.99 × 1 + 0.009 × 40 + 0.001 × 4,000)
                     = 4 / (0.99 + 0.36 + 4) = 75% of all posts
Tier C fan-out: 750 posts/s × 2,000,000 = 1.5 BILLION insertions/s
\`\`\`

**Three orders of magnitude over capacity.** The hybrid becomes not merely advisable but the only possible design, and even the read path would need rethinking — 750 celebrity posts per second means the merge candidates are dominated by them.

**So the exponent changes the *magnitude* of the problem and not its *existence*.** The hybrid is required at any exponent from 0 upward, because **follower count enters the fan-out cost linearly while it enters the posting rate sub-linearly at most.** That is a robust conclusion and it is worth stating: **the design does not depend on assumptions about how often celebrities post.**

*Where the exponent does matter practically:* it determines whether tier B (20,000 followers) needs to be excluded too. At exponent 0.3, tier B contributes 520,000 insertions/second — half the total and enough to matter. **A higher exponent would push tier B over capacity as well and force a lower threshold.**

**At what threshold does the design stop being a hybrid?**

**Two degenerate limits, and both are worse than the hybrid.**

**Threshold → ∞ (no large accounts): pure fan-out on write.**

Requires that no account has enough followers to break capacity. At this distribution it is 50× over, so it is unavailable. **And even if capacity allowed it, the design loses its cache-rebuild path** — there would be no fan-out-on-read mechanism, so losing the feed cache would leave no way to serve a feed at all.

*The threshold at which it degenerates:* above the largest account's follower count, so above 2 million here.

**Threshold → 0 (everyone is a large account): pure fan-out on read.**

Every feed load traverses the following graph and merges per-account lists. From Part 3: 23 million operations per second, latency proportional to following size, and no cache benefit. **The 25 TB feed cache becomes dead weight and would be deleted**, at which point the design is a graph traversal per request.

*The threshold at which it degenerates:* below the median follower count, so below about 500 here — which is exactly the third case evaluated, and Part 3 shows what it costs.

**So the hybrid's useful range is roughly 1,000 to 500,000 followers**, and within that range the choice is a capacity optimisation. **Outside it, the design collapses into one of two pure strategies, each of which is worse for a specific and different reason** — write capacity on one side, read cost and cache futility on the other.

*And the useful conclusion for an interview:* saying "hybrid" is not an answer. **The answer is the threshold, derived from write capacity, with the read cost computed to show it is affordable** — and being able to say what happens at both extremes demonstrates that the hybrid was chosen rather than recited.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hif-1',
      level: 'basic',
      question: 'Design an Instagram feed. Fan-out on write or on read?',
      guidance:
        'Both — on write for ordinary accounts because reads dominate 50:1, on read above a threshold because one large post would consume the fan-out fleet. Look for the arithmetic on both sides.',
    },
    {
      id: 'iq-hif-2',
      level: 'basic',
      question: 'Why can a chronological feed be much simpler than a ranked one?',
      guidance:
        'Chronological is a merge of sorted lists servable entirely from cache; ranked needs candidate retrieval plus model scoring over viewer and post features. A strong answer names it as a second system.',
    },
    {
      id: 'iq-hif-3',
      level: 'intermediate',
      question: 'Where do you set the large-account threshold, and how do you justify it?',
      guidance:
        'Derive from capacity: no single post above a small share of fan-out throughput, giving tens of thousands of followers. Look for hysteresis and a hard cap in the dispatcher.',
    },
    {
      id: 'iq-hif-4',
      level: 'intermediate',
      question: 'Why does the hybrid actually work, rather than just moving the cost?',
      guidance:
        'The asymmetry inverts: a large shared audience means one cached post list serves all followers, so accounts expensive to write are cheap to read. Not a coincidence — the same property from two sides.',
    },
    {
      id: 'iq-hif-5',
      level: 'advanced',
      question: 'Compute the ranking load and say whether it is feasible.',
      guidance:
        '150,000 loads/second × 500 candidates = 75 million scorings/second, which is not. Excellent answers reduce it with ranked-page caching, two-stage ranking and batching to roughly 6 million.',
    },
    {
      id: 'iq-hif-6',
      level: 'advanced',
      question: 'The entire feed cache is lost. What happens?',
      guidance:
        'Every load becomes fan-out on read — slow and correct. Excellent answers note this is a second, independent reason for the hybrid: fan-out on read is also the rebuild path, and a write-only design has no answer.',
    },
    {
      id: 'iq-hif-7',
      level: 'followup',
      question: 'An account grows past the threshold. What breaks?',
      guidance:
        'Its old posts are in precomputed lists and new ones are not, so the merge must deduplicate rather than concatenate. Plus flapping at the boundary, requiring hysteresis, and the strategy recorded per post.',
    },
    {
      id: 'iq-hif-8',
      level: 'followup',
      question: 'How do you paginate a ranked feed?',
      guidance:
        'Not by timestamp (scores are not monotonic in time) and not by offset (re-ranking produces duplicates and omissions). An opaque cursor referencing a materialised ranked page with a short TTL.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hif-1',
      kind: 'what-changes-if',
      prompt:
        'This design ranks the feed with a model. Now change one thing: the feed must be strictly chronological, newest first, with no ranking at all. What gets simpler, and what surprisingly does not?',
      discussion: `Removing ranking removes an entire system, and the simplification is larger than it first appears — but two things survive that people expect to go away.

**What disappears entirely.**

**The model-serving tier.** The 75-million-scorings-per-second problem, the two-stage ranking, the batching infrastructure, the GPU fleet. **All of it, gone**, and it was the most operationally complex part of the design.

**The ranked-page cache and its cursor complexity.** With chronological order, pagination is a simple keyset cursor on \`(created_at, post_id)\` — the pagination lesson's standard answer. **No materialised pages, no TTL, no re-ranking concerns**, and a cursor that remains valid indefinitely.

**The ranking fallback path.** No ranking service means nothing to degrade to, so the reverse-chronological fallback becomes the only path — which removes a code path that had to be continuously exercised.

**Feature computation.** Viewer-post affinity, engagement history, freshness decay — none of it is needed, which removes a feature store and its own pipeline.

**And a subtle one: the feed becomes cacheable more aggressively.** A ranked feed's result depends on the viewer's model features, which change; a chronological feed depends only on who they follow and what was posted. **So a chronological feed page can be cached longer and shared more.**

**What gets simpler in the hybrid.**

**The merge becomes a true merge of sorted lists**, which is a linear-time k-way merge with a heap rather than a scoring pass. Cheaper and simpler.

**And the candidate count drops.** A ranked feed retrieves ~500 candidates to select 20, because the model needs a pool to choose from. **Chronological needs only ~20 plus a margin**, since the newest 20 across all sources *is* the answer. That reduces both the precomputed list read and the celebrity merge.

**What surprisingly does not change.**

**The fan-out arithmetic is identical.** 25 million insertions/second under pure fan-out on write, the 50× capacity overrun, the threshold derivation — **all unchanged**, because they depend on the follower distribution rather than on how the feed is ordered. **The hybrid is still required for exactly the same reason.**

This is worth emphasising because candidates sometimes attribute the celebrity problem to ranking complexity. **It is purely a write-amplification problem and it exists in the simplest possible feed.**

**The feed cache is still 25 TB.** Still 1,000 entries per active user, still the largest infrastructure item, still derived and disposable. **Removing ranking does not reduce the storage**, because the storage is the candidate list rather than the ranking state.

**The active-follower filter is still needed**, for the same 4× reduction.

**The follower graph is still stored twice**, for the same reason.

**And the boundary-crossing problem is unchanged.** An account growing past the threshold still has old posts in precomputed lists and new posts only on the read path, so **the merge still needs deduplication** — a chronological merge with duplicates shows the same post twice, just as a ranked one would.

**What becomes harder, and this is the counter-intuitive part.**

**Strict chronological ordering across two sources requires consistent timestamps.** A ranked feed can tolerate approximate ordering — a score is fuzzy by nature. **Strict "newest first" makes the ordering visible and checkable**, so a post whose \`created_at\` disagrees with its fan-out arrival order produces a visibly wrong feed.

*Concretely:* if the precomputed list is scored by insertion time and the celebrity merge uses \`created_at\`, they are two different clocks. **A ranked feed hides that; a chronological one exposes it.** So the score in the sorted set must be the post's \`created_at\`, not the insertion time — a detail that only matters once ranking is removed.

**And users notice gaps.** A ranked feed that omits a post is invisible — the model chose not to show it. **A chronological feed that omits a post is a visible bug**, because the user can see that a post they expected is missing between two others. So fan-out completeness becomes a correctness requirement rather than a quality one.

**What I would actually do.** Ship chronological if the product allows it, because it removes the most complex component of the design and the arithmetic that forces the hybrid is unaffected. **The ranking is buying engagement, not architecture** — and that is a product trade, priced at one model-serving tier plus a feature pipeline.

**The transferable point.** Removing a component does not remove the constraints that shaped the rest of the design. **The celebrity problem, the cache size, the graph duplication and the boundary-crossing merge all survive**, because they follow from the follower distribution and the read-to-write ratio rather than from ranking. Identifying which parts of a design are forced by structure and which by a feature is what lets you cost a feature accurately.`,
    },
    {
      id: 'al-hif-2',
      kind: 'debug',
      prompt:
        'A feed built to this design has a complaint: some users report that posts from accounts they follow "never appear" in their feed, while the same posts are visible on those accounts\' profile pages. It affects a small percentage of follow relationships, not whole accounts. Diagnose it.',
      discussion: `The post exists and is visible on the author's profile, so \`posts\` and \`author_posts\` are correct. The failure is per follow *relationship* rather than per account or per user, which is the strongest clue — it localises the fault to something that varies by edge rather than by node.

**Hypothesis 1 — the follower graph's two copies are inconsistent.** The graph is stored twice: \`follows\` partitioned by follower, \`followers\` partitioned by followee. **If a follow wrote one row and not the other, the relationship exists from one direction and not the other.**

\`\`\`
follows(A → B) exists     → A's profile shows they follow B
followers(B ← A) missing  → fan-out never inserts B's posts into A's feed
\`\`\`

**This produces exactly the reported symptom**: the user believes they follow the account (the UI reads \`follows\`), and fan-out never targets them (it reads \`followers\`).

*Why a small percentage of relationships:* it requires a failure between the two writes — a crash, a timeout, a partial transaction.

*Check:* for affected pairs, verify both rows exist. **One query, and it is conclusive.** Then check whether follows are written in a transaction or as two independent writes.

**Hypothesis 2 — the user is not counted as "active", so fan-out skips them.** The design fans out only to followers active in the last 30 days. **A user just past the activity boundary is skipped**, and their feed is supposed to be rebuilt on read — but if the rebuild path only merges *large* accounts, an inactive user's feed never gets ordinary accounts' posts.

**This is a real gap in the design as stated.** The lesson says an inactive user's feed is "rebuilt by fan-out on read for their whole following", but the read path described only merges large accounts. **If the rebuild-on-return is not implemented as a full rebuild, the returning user has a permanently sparse feed.**

*Why per-relationship:* it would actually be per-user, affecting all their ordinary follows at once. **So if the affected users report missing posts from many accounts rather than a few, this is the answer.**

*Check:* whether affected users have a recent activity gap, and whether a full-rebuild path exists and fires on return.

**Hypothesis 3 — the account is just below the large-account threshold and the flag is stale.** If \`is_large_account\` was set but the account's follower count fell, or if the flag was set incorrectly, the account is excluded from fan-out. **And the read path merges only accounts the user follows that are *currently* flagged large** — so if the flag was later cleared, those posts are in neither source.

\`\`\`
Post made while flagged large  → not in precomputed lists
Flag later cleared             → read path no longer merges the account
                               → the post is invisible to everyone
\`\`\`

**This is the boundary-crossing problem in the reverse direction**, and the design's fix — recording the strategy on the post — is what prevents it. **If that field is missing, this is a real hole.**

*Check:* whether affected posts belong to accounts near the threshold, and whether the post records its fan-out strategy.

**Hypothesis 4 — the feed list was trimmed past the post.** Lists are trimmed to 1,000 entries. **A user following many prolific accounts has their list churn quickly**, so a post from a low-volume account can be trimmed out before the user next opens the app.

*Why per-relationship:* it would affect posts from *infrequent* posters specifically, because those posts are outnumbered. **So if the affected accounts are ones that post rarely, this is it.**

*Check:* the affected users' following counts and the post rate across their following. A user following 5,000 active accounts churns 1,000 entries fast.

**Hypothesis 5 — fan-out silently failed for a batch.** A worker crash mid-fan-out with no resumption leaves a subset of followers without the post. **If fan-out is not chunked with a cursor, or the cursor is not durable, a crash loses the remainder.**

*Why per-relationship:* the affected followers are whichever ones were in the unprocessed portion — arbitrary from the user's perspective.

*Check:* whether fan-out is chunked and resumable, and whether there is a metric for fan-out completion per post. **"Was this post delivered to all targets?" should be answerable and usually is not.**

**What I would check first: for a sample of affected pairs, does the \`followers\` row exist?** One query. It confirms or eliminates hypothesis 1, which is both the most likely given the per-relationship symptom and the most serious — because an inconsistent graph produces this failure permanently and silently for the affected edge.

**Then: whether affected posts record their fan-out strategy** (hypothesis 3) and **whether fan-out is chunked and resumable with a completion metric** (hypothesis 5). Both are structural questions rather than data queries.

**Why the profile page working is the key evidence.**

It proves \`posts\` and \`author_posts\` are correct, which eliminates the entire storage and post-creation path. **The fault is in fan-out targeting or in the read-path merge** — and those are the two places the follower graph is consulted, which is why the graph is the leading hypothesis.

**It also proves the post is not deleted or filtered**, since a moderation filter would hide it everywhere.

**The design changes this incident demands.**

**Make the follow a single atomic write.** Two rows in one transaction, or one row plus an outbox-driven second write with retry. **An inconsistent graph is silent and permanent**, and it is the worst class of bug in this design because the user's own UI tells them the follow exists.

**Add a graph-consistency auditor.** Sample \`follows\` rows and verify the reverse row exists. **This is cheap, catches the failure before users report it, and it is the kind of check that only exists after an incident.**

**Add fan-out completion tracking.** Per post: targets attempted, targets succeeded. **A post that reached 94% of its targets should be visible as such**, and currently nothing records it. This is the observability lesson's outcome metric rather than mechanism metric.

**Implement the full rebuild on return**, explicitly, rather than relying on the celebrity merge to cover it. And **record the fan-out strategy on each post**, which closes hypothesis 3.

**Transferable:** when a symptom varies by *relationship* rather than by *entity*, the fault is in the edge data or in something keyed by the edge — and a bidirectionally-stored graph is the obvious suspect. **Denormalising a graph for two access patterns creates a consistency obligation that is invisible until one direction is missing**, which is why the write must be atomic and why an auditor is worth having.`,
    },
  ],

  revision: {
    bullets: [
      'A 50:1 read-to-write ratio selects fan-out on write; the follower distribution\'s tail forces a hybrid.',
      'A 40-million-follower post is 80 seconds of total fan-out capacity — one post starving all others.',
      'Under pure fan-out on write, the top 0.1% of accounts can be 96% of fan-out volume.',
      'Derive the threshold from capacity: no single post above ~2% of fan-out throughput, giving ~50,000 followers.',
      'The hybrid works because the asymmetry inverts — a large shared audience means one cached list serves all followers.',
      'Set the threshold as high as write capacity permits; higher means cheaper reads, and reads dominate.',
      'Fan out to active followers only — a 4× reduction, and the rebuild path already exists.',
      'The read-path merge must be a union with deduplication, because accounts cross the threshold continuously.',
      'The large-account flag needs hysteresis, and the dispatcher needs a hard cap in case the flag is wrong.',
      'Record the fan-out strategy on each post, so the read path knows where to expect it.',
      '150,000 loads/second × 500 candidates is 75 million scorings/second — infeasible.',
      'Ranked-page caching, two-stage ranking and batching bring that to about 6 million.',
      'Ranking must degrade to reverse-chronological, and that path must carry live traffic continuously.',
      'The feed cache is derived and disposable — no persistence, and losing it means fan-out on read.',
      'That is a second, independent reason for the hybrid: fan-out on read is the cache-rebuild path.',
      'The follower graph is stored twice, so a follow must be one atomic write or it silently breaks one edge.',
      'A ranked feed cannot paginate by timestamp or offset; the cursor references a materialised ranked page.',
      'The author must see their own post immediately, from `author_posts`, regardless of fan-out lag.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A hybrid fan-out system: precomputed per-user candidate lists for ordinary accounts, live read-time merge for high-follower accounts, feeding a two-stage ranking service that degrades to reverse-chronological.',
    whyItExists:
      'Because a read-heavy workload wants precomputation on the write path, and a power-law follower distribution means a single post from the tail would consume the entire fan-out capacity.',
    whenToUse: [
      'Any social feed where follower counts follow a power law.',
      'Fan-out on write for accounts below a capacity-derived threshold.',
      'Fan-out on read above it, and as the cache-rebuild path for everyone.',
      'Two-stage ranking whenever per-load candidate scoring exceeds serving capacity.',
    ],
    whenNotToUse: [
      'Pure fan-out on write when any account has a large following.',
      'Pure fan-out on read at a high read-to-write ratio.',
      'A model-serving tier at all, if the feed can be chronological.',
      'Persistence on the feed cache, which is derived data.',
      'Offset or timestamp pagination over a ranked result.',
    ],
    alternatives: [
      'A strictly chronological feed, which removes the ranking system entirely.',
      'Fan-out on read only, when writes vastly outnumber reads.',
      'A per-author cached post list, which is what makes the celebrity read path cheap.',
      'Reverse-chronological ordering as the ranking fallback.',
    ],
    tradeoffs: [
      'Fan-out on write buys one-lookup reads and costs write amplification per follower.',
      'Fan-out on read buys trivial writes and costs read latency proportional to following size.',
      'A higher threshold buys cheaper reads and costs write capacity.',
      'Active-follower filtering buys a 4× reduction and costs a slower first load after absence.',
      'Ranked-page caching buys most of the ranking load and costs feed freshness within the TTL.',
      'Two-stage ranking buys feasibility and costs recall in the pruning stage.',
    ],
    failureModes: [
      'One large-account post consuming the fan-out fleet and delaying everyone.',
      'A threshold guessed rather than derived, and too high by orders of magnitude.',
      'Concatenating rather than deduplicating in the merge, showing posts twice after a threshold crossing.',
      'An account flapping across the threshold with no hysteresis.',
      'A stale large-account flag triggering a 40-million-insertion fan-out with no dispatcher cap.',
      'Model scoring every candidate on every load, at an infeasible request rate.',
      'A ranking outage becoming a feed outage because there is no fallback.',
      'An untested fallback failing during the incident it exists for.',
      'The feed cache persisted, paying durability cost for derived data.',
      'An inconsistent bidirectional follower graph silently breaking one follow edge.',
      'Fan-out failing partway with no completion tracking, leaving a subset of followers without the post.',
      'The author not seeing their own post because their timeline reads the feed cache.',
    ],
    followUpQuestions: [
      'What is the read-to-write ratio, and what does the follower distribution look like?',
      'Where is the large-account threshold, and how was it derived?',
      'What is total fan-out volume, and does it fit in capacity?',
      'Do you fan out to all followers or only active ones?',
      'Is the read-path merge a union with deduplication?',
      'What happens when an account crosses the threshold?',
      'What is the ranking load, and is it feasible?',
      'What does the feed return when ranking is unavailable, and when was that path last exercised?',
      'What happens when the feed cache is lost?',
      'Is a follow one atomic write across both graph directions?',
      'Can you tell whether a given post reached all its fan-out targets?',
    ],
  },
});
