const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });

  res.end(
    JSON.stringify({
      success: true,
      message: "PayHub backend is running",
      project: "PayHub",
      version: "1.0.0"
    })
  );
});

server.listen(PORT, () => {
  console.log(`PayHub server running on port ${PORT}`);
});
