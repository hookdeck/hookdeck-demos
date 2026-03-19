import express, { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Helper function to format time as [HH:MM:SS]
function formatTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
}

// POST endpoint to receive GitHub webhooks
app.post('/webhooks/github', (req: Request, res: Response) => {
  const eventType = req.headers['x-github-event'] as string || 'unknown';
  const bodySize = JSON.stringify(req.body).length;
  
  console.log(`${formatTime()} <- Received GitHub event: ${eventType} (${bodySize} bytes)`);
  
  res.status(200).json({ received: true });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`${formatTime()} Error:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`${formatTime()} Server listening on port ${PORT}`);
  console.log(`${formatTime()} Webhook URL: http://localhost:${PORT}/webhooks/github`);
});