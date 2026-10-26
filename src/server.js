import 'dotenv/config';
import app from './app.js';
import connectDB from './db/db.js';
import { startReminderCron } from './cron/reminderCron.js';

const port = Number(process.env.PORT) || 5000;

const startServer = async () => {
  await connectDB();
  startReminderCron();

  const server = app.listen(port, () => {
    console.log(`Remindly API listening on port ${port}.`);
  });

  server.on('error', (error) => {
    console.error(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
};

startServer().catch((error) => {
  console.error(`Backend startup failed: ${error.name}`);
  process.exitCode = 1;
});
