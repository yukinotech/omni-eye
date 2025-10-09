const fs = require("fs");
const path = require("path");

const distPath = path.join(__dirname, "..", "..", "dist", "mcp-server", "index.js");
const content = fs.readFileSync(distPath, "utf8");
fs.writeFileSync(distPath, "#!/Users/bytedance/.nvm/versions/node/v20.19.5/bin/node\n" + content);

const binPath = "/Users/bytedance/.nvm/versions/node/v20.19.5/bin/mcp-bundle";
fs.chmodSync(binPath, 0o755);
