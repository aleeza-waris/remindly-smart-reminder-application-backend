import express from 'express';
import { createCorsMiddleware } from './config/cors.js';
import authRoutes from './routes/authRoutes.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import reminderRoutes from './routes/reminderRoutes.js';

const app = express();

app.use(createCorsMiddleware());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/reminders', reminderRoutes);

app.use((_request, response) => {
  response.status(404).json({
    statusCode: 404,
    success: false,
    message: 'Route not found',
    data: null,
    errors: [],
  });
});

app.use(errorMiddleware);

export default app;
