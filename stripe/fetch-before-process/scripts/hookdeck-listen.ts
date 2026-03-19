import { exec, spawn } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

const hookdeckApiKey = process.env.HOOKDECK_API_KEY;
if (!hookdeckApiKey) {
  console.error('HOOKDECK_API_KEY is not defined in your .env file.');
  process.exit(1);
}

const port = process.env.PORT || 3456;

const ciCommand = `hookdeck ci --api-key ${hookdeckApiKey}`;

console.log(`Running: ${ciCommand}`);

exec(ciCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error running 'hookdeck ci': ${error.message}`);
    console.error(stderr);
    process.exit(1);
  }
  console.log(stdout);
  console.error(stderr);

  const listenCommand = 'hookdeck';
  const listenArgs: (string | number)[] = ['listen', port, 'stripe_invoice_webhooks', '--path /api/stripe/invoices'];

  console.log(`Running: ${listenCommand} ${listenArgs.join(' ')}`);

  const listenProcess = spawn(listenCommand, listenArgs as string[], { stdio: 'inherit', shell: true });

  listenProcess.on('close', (code) => {
    process.exit(code ?? 1);
  });

  listenProcess.on('error', (err) => {
    console.error('Failed to start hookdeck listen process.');
    console.error(err);
    process.exit(1);
  });
});