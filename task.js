"use strict";

const Twit = require("twit");
const markov = requireMarkov();
const tokenizer = requireTokenizer();
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
    tweet_mode: "extended",
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
      // console.log("result: ", statuses);
      // console.log("result: ", statuses.map(x => x.full_text));
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
      tweet: m.full_text,
      id: m.id_str,
      username: getUserFromMention(m)
    }));

    resolve(botCalls);
  });
}

function isCallingMe(mention) {
  const normalizedText = normalize(mention.full_text);
  const matches = queries.some(q => q.regex.test(normalizedText));
  return matches && mention.user.screen_name != BOT_NAME && !mention.retweeted;
}

function getUserFromMention(mention) {
  const normalizedText = normalize(mention.full_text);
  const query = queries.find(q => q.regex.test(normalizedText));
  const username = query.regex.exec(normalizedText)[1];
  return username;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/í/g, "i")
    .replace(/é/g, "e");
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
    tweet_mode: "extended",
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
    const texts = tweets.map(t => t.full_text);
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

// Fix:
// Provisioning 3 modules...
// hx-markov-chain@1.2.0 is failed
// hx-tokenizer@1.0.0 is failed
// twit@2.2.9 is available
// The module hx-markov-chain@1.2.0 failed to build.
// error Command failed with exit code 7.

function requireMarkov() {
  var START = " ^";
  var END = " $";
  var DEPTH = 3;

  function create() {
    return { count: 0, tokens: {} };
  }

  function update(model, chain) {
    var depth = DEPTH;
    var fullChain = [].concat(START, chain, END);
    for (var i = 1; i <= fullChain.length; i++) {
      var start = i < depth ? 0 : i - depth;
      var end = i;
      var currentChain = fullChain.slice(start, end);
      add(model, currentChain);
    }
  }

  function run(model) {
    var chain = [START];
    var token = START;
    while (token != END) {
      var prev = chain.slice(-DEPTH + 1);
      var token = next(model, prev);
      chain.push(token);
    }
    return chain.slice(1, -1);
  }

  function add(model, chain) {
    var node = getNode(model, chain);
    node.count += 1;
    var next = chain.slice(1);

    if (next.length) {
      add(model, next);
    } else {
      model.count += 1;
    }
  }

  function getNode(model, chain) {
    var node = model;
    chain.forEach(function(token) {
      node.tokens[token] = node.tokens[token] || create();
      node = node.tokens[token];
    });
    return node;
  }

  function count(model, chain) {
    var node = getNode(model, chain);
    return node.count;
  }

  function next(model, prev) {
    var node = getNode(model, prev);
    if (!node.count) {
      throw Error("Path missing from model " + prev);
    }
    var pivot = Math.random() * node.count;
    var tokens = Object.keys(node.tokens);
    var i = 0;
    for (var k = (i = 0); k < tokens.length; k++) {
      var token = tokens[k];
      i += node.tokens[token].count;
      if (i > pivot) {
        return token;
      }
    }
  }

  return {
    START: START,
    END: END,
    create: create,
    update: update,
    count: count,
    run: run
  };
}

function requireTokenizer() {
  function tokenize(text) {
    var regexes = [
      url,
      hashtag,
      mention,
      smiley,
      emoji,
      acronyms,
      punctuation,
      words,
      eol,
      other
    ];

    var source = regexes
      .map(function(re) {
        return re.source;
      })
      .join("|");

    var regex = new RegExp(source, "gi");

    return text.match(regex);
  }

  function join(tokens) {
    if (!tokens || !tokens.length) {
      return "";
    }

    var text = tokens[0];
    var openQuotes = {};
    openQuotes[text] = true;

    for (var i = 1; i < tokens.length; i++) {
      var token = tokens[i];
      var prev = tokens[i - 1];

      var prevOpening = prev.match(quotes)
        ? openQuotes[prev]
        : prev.match(opening);
      var thisClosing = token.match(quotes)
        ? openQuotes[token]
        : token.match(closing);
      var sep = prevOpening || thisClosing ? "" : " ";
      text += sep + token;

      if (token.match(quotes)) {
        openQuotes[token] = !openQuotes[token];
      }
    }

    return text;
  }

  var tokenizer = {
    tokenize: tokenize,
    join: join
  };

  // Regexes:
  var url = /[a-z]+:\/\/[a-z0-9-_]+.[a-z0-9-_:%&~?/.=]+/;
  var hashtag = /[#]+[a-z0-9-_]+/;
  var mention = /(^.)?\B@[a-z0-9_-]+/;
  var smiley = /:\(|:\)|:P|:p|:O/;
  var punctuation = /[.,;â€¦'Â¿Â¡!?"`:()[\]{}]/;
  var words = /[a-zÃ -ÃºÃ¼'â€™-]+\d*/;
  var acronyms = /([a-z]\.){2,}/;
  var eol = /\n/;
  var other = /\S+/;

  var opening = /^['"`Â¿Â¡([{\n]$/;
  var closing = /^[.,;â€¦!?'"`:)\]}\n]$/;
  var quotes = /^['"`]$/;

  // Emoji regex from: https://github.com/mathiasbynens/emoji-regex
  var emoji = /[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2648-\u2653\u2660\u2663\u2665\u2666\u2668\u267B\u267F\u2692-\u2694\u2696\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD79\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED0\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3]|\uD83E[\uDD10-\uDD18\uDD80-\uDD84\uDDC0]|\uD83C\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uD83C\uDDFE\uD83C[\uDDEA\uDDF9]|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDFC\uD83C[\uDDEB\uDDF8]|\uD83C\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uD83C\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF8\uDDFE\uDDFF]|\uD83C\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uD83C\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uD83C\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uD83C\uDDF4\uD83C\uDDF2|\uD83C\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uD83C\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uD83C\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uD83C\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uD83C\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uD83C\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uD83C\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uD83C\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uD83C\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uD83C\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uD83C\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uD83C\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF]|\uD83C\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uD83C\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|[#\*0-9]\u20E3/;

  return tokenizer;
}
