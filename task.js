const Twit = require("twit");
const markov = require("hx-markov-chain");
const tokenizer = require("hx-tokenizer");
const BOT_NAME = "sanatabot";

const queries = [
  { regex: /que diria (\w+)/, keyword: "diria" },
  { regex: /what would (\w+) say/, keyword: "say" },
  { regex: /que diria @(\w+)/, keyword: "diria" },
  { regex: /what would @(\w+) say/, keyword: "say" }
];

function buildQuery() {
  const keywords = queries.map(q => q.keyword);
  const kquery = keywords.join(" OR ");
  return kquery + " @" + BOT_NAME;
}

module.exports = (ctx, cb) => {
  const twitter = new Twit({
    consumer_key: ctx.secrets.consumer_key,
    consumer_secret: ctx.secrets.consumer_secret,
    access_token: ctx.secrets.access_token,
    access_token_secret: ctx.secrets.access_token_secret
  });

  getStorageData(ctx)
    .then(data => {
      const mentionsPromise = getNewMentions(twitter, data.lastId);

      mentionsPromise
        .then(result => {
          if (!result.lastId) return;
          data.lastId = result.lastId;
          return setStorageData(ctx, data);
        })
        .catch(error => console.log(error));

      return mentionsPromise
        .then(result => {
          const statuses = result.statuses;
          return getBotCalls(result.statuses);
        })
        .then(botCalls => {
          return replyToCalls(twitter, botCalls);
        });
    })
    .then(() => cb(null, "OK"))
    .catch(error => cb(error));
};

function getNewMentions(twitter, lastId) {
  const searchParams = {
    q: buildQuery(),
    count: 100,
    since_id: lastId,
    include_entities: false
  };
  return new Promise((resolve, reject) => {
    twitter.get("search/tweets", searchParams, (error, result, response) => {
      if (error) return reject(error);
      const lastId = result.search_metadata.max_id_str;
      const statuses = result.statuses;
      console.log(result.search_metadata);
      console.log("result count: ", statuses.length);
      resolve({ lastId, statuses });
    });
  });
}

function getStorageData(ctx) {
  return new Promise((resolve, reject) => {
    ctx.storage.get((error, data) => {
      error ? reject(error) : resolve(data || {});
    });
  });
}

function setStorageData(ctx, data) {
  return new Promise((resolve, reject) => {
    ctx.storage.set(data, error => {
      error ? reject(error) : resolve();
    });
  });
}

function getBotCalls(mentions) {
  return new Promise((resolve, reject) => {
    if (!mentions || !mentions.length) {
      resolve([]);
    }

    const botCalls = mentions.filter(isCallingMe).map(m => ({
      tweet: m.text,
      id: m.id_str,
      username: getUserFromMention(m)
    }));

    resolve(botCalls);
  });
}

function isCallingMe(mention) {
  const normalizedText = normalize(mention.text);
  const matches = queries.some(q => q.regex.test(normalizedText));
  return matches && mention.user.screen_name != BOT_NAME && !mention.retweeted;
}

function getUserFromMention(mention) {
  const normalizedText = normalize(mention.text);
  const query = queries.find(q => q.regex.test(normalizedText));
  const username = query.regex.exec(normalizedText)[1];
  return username;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace("í", "i")
    .replace("é", "e");
}

function replyToCalls(twitter, botCalls) {
  return Promise.all(botCalls.map(call => replyToCall(twitter, call)));
}

function replyToCall(twitter, botCall) {
  console.log(botCall);
  const callId = botCall.id;
  const username = botCall.username;
  return getGoodReply(twitter, username).then(reply => {
    console.log("reply:", reply);
    return twitter.post("statuses/update", {
      status: reply,
      in_reply_to_status_id: callId,
      auto_populate_reply_metadata: true
    });
  });
}

// *** Generate reply *** //

// Maximum number of pages to fetch
const MAX_PAGES = 25;

function getPage(twitter, options) {
  const opts = {
    count: 1000,
    trim_user: false,
    exclude_replies: false,
    include_rts: false,
    since_id: 1
  };
  Object.assign(opts, options);

  return twitter.get("statuses/user_timeline", opts).then(response => {
    if (response.data.errors) {
      return;
    }
    return response.data.filter(t => t.id_str !== opts.max_id);
  });
}

function getPages(twitter, lastPage, pages, opts) {
  if (lastPage) {
    opts.max_id = lastPage[lastPage.length - 1].id_str;
  }
  return getPage(twitter, opts).then(page => {
    if (!page) return pages;
    pages.push(page);
    if (!page.length || !pages.length > MAX_PAGES) {
      return getPages(twitter, page, pages, opts);
    }
    return pages;
  });
}

function getAll(twitter, username) {
  const opts = {
    screen_name: username,
    since_id: "1"
  };

  return getPages(twitter, null, [], opts).then(pages => {
    const tweets = pages.reduce((a, b) => a.concat(b), []);
    return tweets;
  });
}

function trainModel(tweets) {
  const model = markov.create();
  tweets.forEach(tweet => {
    const tokens = tokenizer.tokenize(tweet);
    markov.update(model, tokens);
  });
  return model;
}

function getReply(model) {
  const chain = markov.run(model);
  let reply = tokenizer.join(chain);
  return reply;
}

function sanitizeReply(reply) {
  // remove reply_metadata
  let newReply = reply.replace(/^(@\w+ )*/, "");
  // escape mentions
  newReply = newReply.replace(/@/g, "@ ");
  if (newReply.length > 140) {
    replt = newReply.slice(0, 137) + "...";
  }
  return newReply;
}

function getGoodReply(twitter, username) {
  return getAll(twitter, username).then(tweets => {
    const texts = tweets.map(t => t.text);
    const model = trainModel(texts);
    for (let i = 0; i < 100; i++) {
      const reply = getReply(model);
      if (!texts.some(t => t == reply)) {
        return sanitizeReply(reply);
      }
    }
    return sanitizeReply(reply);
  });
}
