import handler from "../api/news.js";

const request = {
  url: "http://localhost/api/news?category=technology&lang=en"
};

const response = {
  statusCode: 200,
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    console.log(JSON.stringify({ statusCode: this.statusCode, count: payload.articles?.length || 0 }, null, 2));
  }
};

await handler(request, response);
