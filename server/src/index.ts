// 服务入口：PORT=8903 起服务；退出前冲刷防抖中的持久化。
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 8903);
const { app, store } = createApp();

const server = app.listen(PORT, () => {
  console.log(`[collab-paint-server] listening on http://localhost:${PORT}`);
});

// 防抖未落盘的数据在退出前冲刷
const flushAndExit = (sig: string) => {
  try { store.flush(); } finally { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); }
  console.log(`[collab-paint-server] received ${sig}, flushed store`);
};
process.on('SIGINT', () => flushAndExit('SIGINT'));
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
