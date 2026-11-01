import { createRelayServer } from '../../src/server.mjs';
const app = createRelayServer({ workspace: process.env.TEST_ROOT, dataRoot: process.env.TEST_ROOT + '/data', bins: { claude: process.env.AI_RELAY_CLAUDE_BIN, codex: process.env.AI_RELAY_CODEX_BIN } });
app.server.listen(0, '127.0.0.1', () => process.send({ port: app.server.address().port }));
process.on('message', async () => { await app.close(); process.disconnect(); });
