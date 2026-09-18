// Minimal mock of the two Vercel Edge Config REST calls used by api/content.js.
// Test-only — delete after verification.
import http from "http";

let stored = null; // { key, value }

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer mock-token") {
      res.statusCode = 401;
      return res.end("{}");
    }
    if (req.method === "GET" && req.url.startsWith("/v1/edge-config/mock-id/items")) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(stored ? [stored] : []));
    }
    if (req.method === "PUT" && req.url === "/v1/edge-config/mock-id/items/portfolio_content") {
      try {
        const parsed = JSON.parse(body);
        const item = parsed.items && parsed.items[0];
        if (!item || item.key !== "portfolio_content") {
          res.statusCode = 400;
          return res.end("{}");
        }
        stored = { key: "portfolio_content", value: item.value };
        res.setHeader("Content-Type", "application/json");
        return res.end('{"ok":true}');
      } catch {
        res.statusCode = 400;
        return res.end("{}");
      }
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

server.listen(8499, "127.0.0.1", () => console.log("mock store on 8499"));
