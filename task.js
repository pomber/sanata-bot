const Twit = require("twit");
const BOT_NAME = "sanatabot";

const queries = [
  { regex: /que diria (\w+)/, keyword: "diria" }, //TODO
  { regex: /what would (\w+) say/, keyword: "say" }, //TODO
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
          data.lastId = result.lastId;
          return setStorageData(ctx, data);
        })
        .catch(error => console.log(error));

      return mentionsPromise.then(result => {
        const statuses = result.statuses;
        return processMentions(result.statuses);
      });
    })
    .then(() => cb(null, "OK"))
    .catch(error => cb(error));
};

function getNewMentions(twitter, lastId) {
  const searchParams = {
    q: buildQuery(),
    count: 1000,
    // TODO
    // since_id: lastId,
    include_entities: false
  };
  return new Promise((resolve, reject) => {
    twitter.get("search/tweets", searchParams, (error, result, response) => {
      if (error) return reject(error);
      const lastId = result.search_metadata.max_id_str;
      const statuses = result.statuses;
      console.log(result.search_metadata);
      console.log("count: ", statuses.length);
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

function processMentions(mentions) {
  return new Promise((resolve, reject) => {
    if (!mentions || !mentions.length) {
      resolve();
    }
    console.log(mentions.map(m => m.text));
    const botCalls = mentions
      .filter(isCallingMe)
      .map(m => ({ tweet: m.text, username: getUserFromMention(m) }));
    console.log(botCalls);
    // console.log(mentions[0]);
    resolve();
  });
}

function isCallingMe(mention) {
  const normalizedText = normalize(mention.text);
  const matches = queries.some(q => q.regex.test(normalizedText));
  return matches; //TODO && mention.user.screen_name != BOT_NAME && !mention.retweeted
}

function getUserFromMention(mention) {
  const normalizedText = normalize(mention.text);
  const query = queries.find(q => q.regex.test(normalizedText));
  const username = query.regex.exec(normalizedText)[1];
  return username;
}

function normalize(text) {
  return text.toLowerCase().replace("í", "i");
}
