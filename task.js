const Twit = require("twit");

module.exports = (context, cb) => {
  const consumer_key = context.secrets.consumer_key;
  const consumer_secret = context.secrets.consumer_secret;

  const twitter = new Twit({
    consumer_key,
    consumer_secret,
    app_only_auth: true
  });

  twitter.get(
    "search/tweets",
    { q: "@jack", count: 3 },
    (err, data, response) => {
      const tweets = data.statuses.map(s => s.text);
      console.log(tweets);
    }
  );

  cb(null, "ok");
};
