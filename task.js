const Twit = require("twit");
const BOT_NAME = "sanatabot";

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
    q: "@jack",
    since_id: lastId,
    count: 1000,
    include_entities: false
  };
  return new Promise((resolve, reject) => {
    twitter.get("search/tweets", searchParams, (error, result, response) => {
      if (error) return reject(error);
      console.log(result.search_metadata);
      const lastId = result.search_metadata.max_id_str;
      const statuses = result.statuses;
      console.log(statuses.length);
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
    const texts = mentions.filter(isCallingMe).map(m => m.text);
    console.log(texts);
    // console.log(mentions[0]);
    resolve();
  });
}

function isCallingMe(mention) {
  return true; //&& mention.user.screen_name != BOT_NAME && !mention.retweeted
}
